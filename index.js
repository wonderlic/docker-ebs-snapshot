var AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION
});

var ec2 = new AWS.EC2();

function _purgeExpiredSnapshots(cb) {

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
              if (err) {
                console.log('ERROR:', snapShot.SnapshotId);
              }
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

function _handleError(err) {
  console.error(err);
}

function _handleErrorAndExit(err) {
  console.error(err);
  process.exit(1);
}

// Main processing logic...

function _start() {
  _purgeExpiredSnapshots(function(err) {
    if (err) {return _handleError(err); }
  })
}

_start();
