const _ = require('lodash');
const commandLineArgs = require('command-line-args');
const debug = require('debug');

const AwsEC2Service = require('./AwsEC2Service.js');

//---Debug Options
const optionsDebug = debug('options');
const purgeDebug = debug('purge');
const tagDebug = debug('tag');
const snapshotDebug = debug('snapshot');

const cli = commandLineArgs([
  {name: 'purge', description: 'If set, purge any expired snapshots.', alias: 'p', type: Boolean, defaultOption: false},
  {name: 'snapshotTag', description: 'If set, create snapshots for any volumes matching this tag.', alias: 's', type: String},
  {name: 'purgeAfter', description: 'If set (in hours), add the PurgeAfterFE tag to any snapshots created.', alias: 'k', type: Number},
  {name: 'copyTo', description: 'If set, copy any snapshots created to this destination region.', alias: 'c', type: String},
  {name: 'throttle', description: 'If set, override the time delay (in milliseconds) between each purge request.', alias: 't', type: Number, defaultValue: 250}
]);

const options = cli.parse();
optionsDebug('options %o', options);

const ec2 = new AwsEC2Service({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION
});

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function _purgeExpiredSnapshots(throttleDelay) {
  console.log('Purging expired snapshots');

  var modEpoch = Math.floor((new Date()).getTime() / 1000);

  const snapshots = await ec2.listSnapshotsWithTag('PurgeAllow');
  for (const snapshot of snapshots) {

    const purgeAfterFE = _getTagValue(snapshot.Tags, 'PurgeAfterFE');
    if (purgeAfterFE && purgeAfterFE < modEpoch ) {
      await ec2.deleteSnapshot(snapshot.SnapshotId);
      console.log('Deleted expired SnapshotId: %s', snapshot.SnapshotId);

      await sleep(throttleDelay); // Throttle the deletes so AWS doesn't error on over limit
    }
  }
}

async function _applyTagsToSnapshot(snapshotId, volumeName, purgeAfterFE) {
  const tags = [];

  if (volumeName) {
    tags.push({Key: 'Name', Value: volumeName});
  }
  if (purgeAfter > 0) {
    tags.push({Key: 'PurgeAllow', Value: 'true'});
    tags.push({Key: 'PurgeAfterFE', Value: purgeAfterFE.toString()});
  }

  if (tags.length > 0) {
    await ec2.createTags(snapshotId, tags);
  }
}

async function _createSnapshots(snapshotTag, purgeAfter, copyTo) {
  console.log('Creating snapshots for volumes with tag: %s', snapshotTag);

  const modEpoch = Math.floor((new Date()).getTime() / 1000);

  let purgeAfterFE = 0;
  if (purgeAfter > 0) {
    purgeAfterFE = modEpoch + (purgeAfter * 60 * 60);
    console.log('Allow snapshots to be purged after %d hours (%d)', purgeAfter, purgeAfterFE);
  }

  const volumes = await ec2.listVolumesWithTag(snapshotTag);
  for (const volume of volumes) {

    const volumeName = _getTagValue(volume.Tags, 'Name');
    const snapshot = await ec2.createSnapshot(volume.VolumeId, `${snapshotTag} - ${modEpoch}`);
    await _applyTagsToShapshot(snapshot.SnapshotId, volumeName, purgeAfterFE);
    console.log('Created snapshot for VolumeId: %s SnapshotId: %s', volumeName ? volume.VolumeId + ' (' + volumeName + ')' : volume.VolumeId, snapshot.SnapshotId);

    if (copyTo) {
      const clonedSnapshot = await ec2.copySnapshot(snapshot.SnapshotId, process.env.AWS_DEFAULT_REGION, copyTo, `CLONE: ${snapshotTag} - ${modEpoch}`);
      await _applyTagsToShapshot(snapshot.SnapshotId, volumeName, purgeAfterFE);
      console.log('Cloned snapshot for VolumeId: %s SnapshotId: %s', volumeName ? volume.VolumeId + ' (' + volumeName + ')' : volume.VolumeId, clonedSnapshot.SnapshotId);
    }
  }
}

function _getTagValue(tags, name) {
  const tag = _.find(tags, {key: name});
  if (tag) {
    return tag.Value;
  }
}

// Main processing logic...

async function main() {
  if (options.snapshotTag) {
    await _createSnapshots(options.snapshotTag, options.purgeAfter, options.copyTo);
  }

  if (options.purge) {
    await _purgeExpiredSnapshots(options.throttle);
  }
}

main()
  .catch(console.error);
