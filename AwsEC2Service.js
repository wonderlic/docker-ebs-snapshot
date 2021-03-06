const _ = require('lodash');
const AWS = require('aws-sdk');

function AwsEC2Service(credentials) {
  AWS.config.update(credentials);
  this._ec2 = promisifyMethods(new AWS.EC2());
}

AwsEC2Service.prototype.listVolumesWithTag = async function(tagName) {
  const response = await this._ec2.describeVolumes({
    Filters: [
      {Name: 'tag-key', Values: [tagName]}
    ]
  });
  return response.Volumes;
};

AwsEC2Service.prototype.createSnapshot = async function(volumeId, description) {
  return this._ec2.createSnapshot({
    VolumeId: volumeId,
    Description: description,
    DryRun: false
  });
};

AwsEC2Service.prototype.getSnapshot = async function(snapshotId) {
  const response = await this._ec2.describeSnapshots({
    Filters: [
      {Name: 'snapshot-id', Values: [snapshotId]}
    ]
  });
  return _.first(response.Snapshots);
};

AwsEC2Service.prototype.copySnapshot = async function(snapshotId, sourceRegion, destinationRegion, description) {
  return this._ec2.copySnapshot({
    SourceSnapshotId: snapshotId,
    SourceRegion: sourceRegion,
    DestinationRegion: destinationRegion,
    Description: description,
    DryRun: false
  });
};

AwsEC2Service.prototype.listSnapshotsWithTag = async function(tagName) {
  const response = await this._ec2.describeSnapshots({
    Filters: [
      {Name: 'tag-key', Values: [tagName]}
    ]
  });
  return response.Snapshots;
};

AwsEC2Service.prototype.deleteSnapshot = async function(snapshotId) {
  return this._ec2.deleteSnapshot({
    SnapshotId: snapshotId,
    DryRun: false
  });
};

AwsEC2Service.prototype.createTags = async function(resources, tags) {
  return this._ec2.createTags({
    Resources: [].concat(resources),
    Tags: tags,
    DryRun: false
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
