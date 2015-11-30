var _ = require('lodash');
var AWS = require('aws-sdk');
var commandLineArgs = require('command-line-args');
var debug = require('debug');

//---Debug Options
var optionsDebug = debug('options');
var purgeDebug = debug('purge');
var tagDebug = debug('tag');
var snapshotDebug = debug('snapshot');

var cli = commandLineArgs([
  {name: 'purge', description: 'If set, purge any expired snapshots.', alias: 'p', type: Boolean, defaultOption: false},
  {name: 'snapshotTag', description: 'If set, create snapshots for any volumes matching this tag.', alias: 's', type: String},
  {name: 'purgeAfter', description: 'If set (in hours), add the PurgeAfterFE tag to any snapshots created.', alias: 'k', type: Number},
  {name: 'throttle', description: 'If set, override the time delay between each purge request.', alias: 't', type: Number, defaultValue: 250}
]);

var options = cli.parse();
optionsDebug('options %o', options);

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION
});

var ec2 = new AWS.EC2();

function _purgeExpiredSnapshots(throttleRate, errorHandler) {
  console.log('Purging expired snapshots');

  var params = {
    DryRun: false,
    Filters: [
      {Name: 'tag-key', Values: ['PurgeAllow']}
    ]
  };

  ec2.describeSnapshots(params, function(err, data) {
    if (err) { return errorHandler(err); }

    var modEpoch = Math.floor((new Date()).getTime() / 1000);
    var timeout = 0;
    // TODO... look into using async.eachSeries with a delay instead of setTimeout
    _.each(data.Snapshots, function(snapshot) {
      _.each(snapshot.Tags, function(tag) {
        if (tag.Key === 'PurgeAfterFE' && tag.Value < modEpoch) {
          var garbageCollectMe = setTimeout(function() {
            var param = {
              SnapshotId: snapshot.SnapshotId,
              DryRun: false
            };

            ec2.deleteSnapshot(param, function(err, data) {
              if (err) { return errorHandler(err); }

              console.log('Deleted expired SnapshotId: %s', snapshot.SnapshotId);
            });
          }, timeout);
          timeout = timeout + throttleRate;//throttle the deletes so AWS doesn't error on over limit
        }
      });
    });
  });
}

function _createTags(resources, tags, errorHandler) {
  tagDebug('_createTags resources: %o, tags: %o', resources, tags);

  if (!_.isArray(resources)) {
    tagDebug('Converting to array');
    var resourcesString = resources;
    resources = [];
    resources[0] = resourcesString;
  }

  var params = {
    Resources: resources,
    Tags: tags,
    DryRun: false
  };

  tagDebug('params: %o', params);

  ec2.createTags(params, function(err, data) {
    snapshotDebug('.createTags err: %o, data: %o', err, data);
    if (err) { return errorHandler(err); }
  });
}

function _createSnapshots(snapshotTag, purgeAfter, errorHandler) {
  console.log('Creating snapshots for volumes with tag: %s', snapshotTag);

  var modEpoch = Math.floor((new Date()).getTime() / 1000);

  var purgeAfterFE = 0;
  if (purgeAfter > 0) {
    purgeAfterFE = modEpoch + (purgeAfter * 60 * 60);
    console.log('Allow snapshots to be purged after %d hours (%d)', purgeAfter, purgeAfterFE);
  }

  var params = {
    DryRun: false,
    Filters: [
      {Name: 'tag-key', Values: [snapshotTag]}
    ]
  };

  ec2.describeVolumes(params, function(err, data) {
    if (err) { return errorHandler(err); }

    _.each(data.Volumes, function(volume) {
      var params = {
        VolumeId: volume.VolumeId,
        Description: snapshotTag + ' - ' + modEpoch,
        DryRun: false
      };
      snapshotDebug('volume: %o', volume);

      ec2.createSnapshot(params, function(err, snapshot) {
        snapshotDebug('ec2.createSnapshot err: %o, snapshot: %o', err, snapshot);
        if (err) { return errorHandler(err); }

        var volumeName = _getTagValue(volume.Tags, 'Name');

        var tags = [];
        if (volumeName) {
          tags.push({Key: 'Name', Value: volumeName});
        }
        if (purgeAfter > 0) {
          tags.push({Key: 'PurgeAllow', Value: 'true'});
          tags.push({Key: 'PurgeAfterFE', Value: purgeAfterFE.toString()});
        }

        if (tags.length > 0) {
          _createTags(snapshot.SnapshotId, tags, errorHandler);
        }

        console.log('Created snapshot for VolumeId: %s SnapshotId: %s', volumeName ? volume.VolumeId + ' (' + volumeName + ')' : volume.VolumeId, snapshot.SnapshotId);
      });
    });
  });
}

function _getTagValue(tags, name) {
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i];
    if (tag.Key === name) {
      return tag.Value;
    }
  }
}

function _handleError(err) {
  console.error(err);
}

function _handleErrorAndExit(err) {
  console.error(err);
  process.exit(1);
}

// Main processing logic...

function _start() {
  if (options.snapshotTag) {
    _createSnapshots(options.snapshotTag, options.purgeAfter, _handleError);
  }

  if (options.purge) {
    _purgeExpiredSnapshots(options.throttle, _handleError);
  }
}

_start();
