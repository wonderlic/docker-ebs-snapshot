const _ = require('lodash');
const AWS = require('aws-sdk');

function AwsEC2Service(credentials) {
  AWS.config.update(credentials);
  this._ec2 = promisifyMethods(new AWS.EC2());
}

AwsEC2Service.prototype.listVolumesWithTag = async function(tagName) {
  const response = await ec2.describeVolumes({
    Filters: [
      {Name: 'tag-key', Values: [tagName]}
    ]
  });
  return response.Volumes;
};

AwsEC2Service.prototype.createSnapshot = async function(volumeId, description) {
  return ec2.createSnapshot({
    VolumeId: volumeId,
    Description: description
  });
};

AwsEC2Service.prototype.copySnapshot = async function(snapshotId, sourceRegion, destinationRegion, description) {
  return ec2.copySnapshot({
    SourceSnapshotId: snapshotId,
    SourceRegion: sourceRegion,
    DestinationRegion: destinationRegion,
    Description: description
  });
};

AwsEC2Service.prototype.listSnapshotsWithTag = async function(tagName) {
  const response = await ec2.describeSnapshots({
    Filters: [
      {Name: 'tag-key', Values: [tagName]}
    ]
  });
  return response.Snapshots;
};

AwsEC2Service.prototype.deleteSnapshot = async function(snapshotId) {
  return ec2.deleteSnapshot({
    SnapshotId: snapshotId
  });
};

AwsEC2Service.prototype.createTags = async function(resources, tags) {
  return ec2.createTags({
    Resources: [].concat(resources),
    Tags: tags
  });
};

function promisifyMethods(obj) {
  return _.mapValues(_.pick(obj, _.functionsIn(obj)), function(method) {
    return promisify(method.bind(obj));
  });
}

function promisify(fn) {
  return function() {
    const context = this;
    const args = _.toArray(arguments);
    return new Promise(function(resolve, reject) {
      fn.apply(context, args.concat(function(error, result) {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }));
    });
  };
}

module.exports = AwsEC2Service;
