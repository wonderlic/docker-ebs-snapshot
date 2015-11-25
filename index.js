var _ = require('lodash');
var AWS = require('aws-sdk');
var commandLineArgs = require('command-line-args');
var debug = require('debug');

//---Debug Options
var optionsDebug = debug('options');
var purgeDebug = debug('purge');
var tagDebug = debug('tag');
var snapShotDebug = debug('snapShot');

var cli = commandLineArgs([
  {name: 'purge', alias: 'p', type: Boolean, defaultOption: false},
  {name: 'snapShotTimerTag', alias: 's', type: String}
]);

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION
});

var ec2 = new AWS.EC2({region: 'us-east-1'});

function _purgeExpiredSnapshots(cb) {
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
    _.each(data.Snapshots, function(snapShot) {
      _.each(snapShot.Tags, function(tag) {
        if (tag.Key === 'PurgeAfterFE' && tag.Value < modEpoch) {
          setTimeout(function() {
            var param = {
              SnapshotId: snapShot.SnapshotId,
              DryRun: false
            };

            ec2.deleteSnapshot(param, function(err, data) {
              if (err) { return cb(err); }
              else {
                console.log('Deleted Snapshot with ID: ', snapShot.SnapshotId);
              }
            });
          }, timeout);
          timeout = timeout + 125;//throttle the deletes so AWS doesn't error on over limit
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

function _createSnapshots(snapShotTimerTag, cb) {
  snapShotDebug('Creating Snapshot');
  var modEpoch = (new Date()).getTime() / 1000;
  var params = {
    DryRun: false,
    Filters: [
      {Name: 'tag-key', Values: [snapShotTimerTag]}
    ]
  };

  ec2.describeVolumes(params, function(err, data) {
    if (err) { return cb(err); }
    _.each(data.Volumes, function(volume) {
      var params = {
        VolumeId: volume.VolumeId,
        Description: snapShotTimerTag + ' - ' + modEpoch,
        DryRun: false
      };
      ec2.createSnapshot(params, function(err, snapShotData) {
        if (err) {return cb(err)}
        snapShotDebug('ReturnData', snapShotData);
        _createTag(snapShotData.SnapshotId, 'Name', volume.VolumeId)
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
  var options = cli.parse();
  optionsDebug('options', options);

  if (options.snapShotTimerTag) {
    _createSnapshots(options.snapShotTimerTag, function(err) {
      if (err) {return _handleError(err); }
    });
  }

  if (options.purge) {
    _purgeExpiredSnapshots(function(err) {
      if (err) {return _handleError(err); }
    });
  }
}

_start();
