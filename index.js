const _ = require('lodash');
const commandLineArgs = require('command-line-args');
const debug = require('debug');

const AwsEC2Service = require('./AwsEC2Service.js');

//---Debug Options
const optionsDebug = debug('options');
const purgeDebug = debug('purge');
const tagDebug = debug('tag');
const snapshotDebug = debug('snapshot');

const options = commandLineArgs([
  {name: 'purge', description: 'If set, purge any expired snapshots.', alias: 'p', type: Boolean, defaultOption: false},
  {name: 'snapshotTag', description: 'If set, create snapshots for any volumes matching this tag.', alias: 's', type: String},
  {name: 'purgeAfter', description: 'If set (in hours), add the PurgeAfterFE tag to any snapshots created.', alias: 'k', type: Number},
  {name: 'copyTo', description: 'If set, copy any snapshots created to this destination region.', alias: 'c', type: String},
  {name: 'throttle', description: 'If set, override the time delay (in milliseconds) between each purge request.', alias: 't', type: Number, defaultValue: 250}
]);
optionsDebug('options %o', options);

const ec2 = new AwsEC2Service({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION
});

let ec2_dest;
if (options.copyTo) {
  ec2_dest = new AwsEC2Service({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: options.copyTo
  });
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function getTimestamp() {
  return Math.floor((new Date()).getTime() / 1000);
}

function getTagValue(tags, name) {
  const tag = _.find(tags, {Key: name});
  if (tag) {
    return tag.Value;
  }
}

async function _purgeExpiredSnapshots(throttleDelay) {
  console.log('Purging expired snapshots');

  const timestamp = getTimestamp();

  const snapshots = await ec2.listSnapshotsWithTag('PurgeAllow');
  for (const snapshot of snapshots) {

    const purgeAllow = getTagValue(snapshot.Tags, 'PurgeAllow');
    const purgeAfterFE = getTagValue(snapshot.Tags, 'PurgeAfterFE');
    if (purgeAllow === 'true' && purgeAfterFE && timestamp > parseInt(purgeAfterFE)) {
      await ec2.deleteSnapshot(snapshot.SnapshotId);
      console.log('Deleted expired SnapshotId: %s', snapshot.SnapshotId);

      await sleep(throttleDelay); // Throttle the deletes so AWS doesn't error on over limit
    }
  }
}

async function _createSnapshots(snapshotTag, purgeAfter, copyTo) {
  console.log('Creating snapshots for volumes with tag: %s', snapshotTag);

  const timestamp = getTimestamp();

  let purgeAfterFE = 0;
  if (purgeAfter > 0) {
    purgeAfterFE = timestamp + (purgeAfter * 60 * 60);
    console.log('Allow snapshots to be purged after %d hours (%d)', purgeAfter, purgeAfterFE);
  }

  const volumes = await ec2.listVolumesWithTag(snapshotTag);
  for (const volume of volumes) {
    const shouldSnapshot = getTagValue(volume.Tags, snapshotTag);
    if (shouldSnapshot === 'true') {

      const volumeName = getTagValue(volume.Tags, 'Name');

      const tags = [];
      if (volumeName) {
        tags.push({Key: 'Name', Value: volumeName});
      }
      if (purgeAfterFE > 0) {
        tags.push({Key: 'PurgeAllow', Value: 'true'});
        tags.push({Key: 'PurgeAfterFE', Value: purgeAfterFE.toString()});
      }

      let snapshot = await ec2.createSnapshot(volume.VolumeId, `${snapshotTag} - ${timestamp}`);
      if (tags) {
        await ec2.createTags(snapshot.SnapshotId, tags);
      }
      console.log('Created snapshot for VolumeId: %s SnapshotId: %s', volumeName ? volume.VolumeId + ' (' + volumeName + ')' : volume.VolumeId, snapshot.SnapshotId);

      if (copyTo) {
        console.log('Waiting for snapshot to complete for VolumeId: %s SnapshotId: %s', volumeName ? volume.VolumeId + ' (' + volumeName + ')' : volume.VolumeId, snapshot.SnapshotId);

        const snapshotId = snapshot.SnapshotId;
        while (snapshot.State === 'pending') {
          await sleep(500);
          snapshot = await ec2.getSnapshot(snapshotId);
        }

        if (snapshot.State === 'completed') {
          const clonedSnapshot = await ec2_dest.copySnapshot(snapshot.SnapshotId, process.env.AWS_DEFAULT_REGION, copyTo, `${snapshotTag} - ${timestamp} [Copied ${snapshotId} from ${process.env.AWS_DEFAULT_REGION}]`);
          if (tags) {
            await ec2_dest.createTags(clonedSnapshot.SnapshotId, tags);
          }
          console.log('Cloned snapshot for VolumeId: %s SnapshotId: %s', volumeName ? volume.VolumeId + ' (' + volumeName + ')' : volume.VolumeId, clonedSnapshot.SnapshotId);
        } else {
          console.log('Could not clone errored snapshot for VolumeId: %s SnapshotId: %s', volumeName ? volume.VolumeId + ' (' + volumeName + ')' : volume.VolumeId, snapshotId);
        }
      }
    }
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
  .catch(err => {
    console.log(err);
  });
