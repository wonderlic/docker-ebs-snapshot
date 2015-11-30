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
  {name: 'purge', alias: 'p', type: Boolean, defaultOption: false},
  {name: 'snapshotTimerTag', alias: 's', type: String},
  {name: 'throttle', alias: 't', type: Number, defaultValue: 125}
]);

var options = cli.parse();
optionsDebug('options %o', options);

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION
});

var ec2 = new AWS.EC2();

function _purgeExpiredSnapshots(throttleRate, cb) {
  purgeDebug('Starting Purge');

  var params = {
    DryRun: false,
    Filters: [
      {Name: 'tag-key', Values: ['PurgeAllow']}
    ]
  };

  ec2.describeSnapshots(params, function(err, data) {
    if (err) { return cb(err); }
    var modEpoch = (new Date()).getTime() / 1000;
    var timeout = 0;
    _.each(data.Snapshots, function(snapshot) {
      _.each(snapshot.Tags, function(tag) {
        if (tag.Key === 'PurgeAfterFE' && tag.Value < modEpoch) {
          setTimeout(function() {
            var param = {
              SnapshotId: snapshot.SnapshotId,
              DryRun: false
            };

            ec2.deleteSnapshot(param, function(err, data) {
              if (err) { return cb(err); }

              purgeDebug('Deleted Snapshot with ID: %s', snapshot.SnapshotId);
            });
          }, timeout);
          timeout = timeout + throttleRate;//throttle the deletes so AWS doesn't error on over limit
        }
      });
    });
  });
}

function _createTag(resources, tagName, tagValue, cb) {
  tagDebug('Creating Tag');

  if (!_.isArray(resources)) {
    tagDebug('Converting to array');
    var resourcesString = resources;
    resources = [];
    resources[0] = resourcesString;
  }

  tagDebug('resources', resources);
  tagDebug('tagName', tagName);
  tagDebug('tagValue', tagValue);

  var params = {
    Resources: resources,
    Tags: [
      {
        Key: tagName,
        Value: tagValue
      }
    ],
    DryRun: false
  };

  tagDebug('params', params);

  ec2.createTags(params, function(err, tagData) {
    if (err) {
      tagDebug('err', err);
      return cb(err);
    }
    tagDebug('tagData', tagData);
  });
}

function _createSnapshots(snapshotTimerTag, cb) {
  snapshotDebug('Creating Snapshot');
  var modEpoch = (new Date()).getTime() / 1000;
  var params = {
    DryRun: false,
    Filters: [
      {Name: 'tag-key', Values: [snapshotTimerTag]}
    ]
  };

  ec2.describeVolumes(params, function(err, data) {
    if (err) { return cb(err); }
    _.each(data.Volumes, function(volume) {
      var params = {
        VolumeId: volume.VolumeId,
        Description: snapshotTimerTag + ' - ' + modEpoch,
        DryRun: false
      };
      ec2.createSnapshot(params, function(err, snapshotData) {
        if (err) {return cb(err)}
        snapshotDebug('ReturnData', snapshotData);
        _createTag(snapshotData.SnapshotId, 'Name', volume.VolumeId)
      });

    });
  });
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
  if (options.snapshotTimerTag) {
    _createSnapshots(options.snapshotTimerTag, function(err) {
      if (err) {return _handleError(err); }
    });
  }

  if (options.purge) {
    _purgeExpiredSnapshots(options.throttle, function(err) {
      if (err) {return _handleError(err); }
    });
  }
}

_start();
