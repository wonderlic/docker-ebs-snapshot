const _ = require('lodash');
const commandLineArgs = require('command-line-args');

const AwsEC2Service = require('./AwsEC2Service.js');

const options = commandLineArgs([
  {name: 'purge', description: 'If set, purge any expired snapshots.', alias: 'p', type: Boolean, defaultOption: false},
  {name: 'snapshotTag', description: 'If set, create snapshots for any volumes matching this tag.', alias: 's', type: String},
  {name: 'purgeAfter', description: 'If set (in hours), add the PurgeAfterFE tag to any snapshots created.', alias: 'k', type: Number},
  {name: 'copyTo', description: 'If set, copy any snapshots created to this destination region.', alias: 'c', type: String},
  {name: 'throttle', description: 'If set, override the time delay (in milliseconds) between each purge request.', alias: 't', type: Number, defaultValue: 250}
]);

const awsRegion = process.env.AWS_DEFAULT_REGION;

const ec2 = new AwsEC2Service({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: awsRegion
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
  console.log(`Purging expired snapshots from region '${awsRegion}' with tag 'PurgeAllow'...`);

  const timestamp = getTimestamp();

  const snapshots = await ec2.listSnapshotsWithTag('PurgeAllow');
  for (const snapshot of snapshots) {

    const purgeAllow = getTagValue(snapshot.Tags, 'PurgeAllow');
    const purgeAfterFE = getTagValue(snapshot.Tags, 'PurgeAfterFE');
    if (purgeAllow === 'true' && purgeAfterFE && timestamp > parseInt(purgeAfterFE)) {
      await ec2.deleteSnapshot(snapshot.SnapshotId);
      console.log(`Deleted expired snapshot '${snapshot.SnapshotId}'.`);

      await sleep(throttleDelay); // Throttle the deletes so AWS doesn't error on over limit
    }
  }
}

async function _createSnapshots(snapshotTag, purgeAfter, copyTo) {
  console.log(`Creating snapshots for volumes from region '${awsRegion}' with tag '${snapshotTag}'...`);

  const timestamp = getTimestamp();

  let purgeAfterFE = 0;
  if (purgeAfter > 0) {
    purgeAfterFE = timestamp + (purgeAfter * 60 * 60);
    console.log(`Allow created snapshots to be purged after ${purgeAfter} hours. (${purgeAfterFE})`);
  }

  const volumes = await ec2.listVolumesWithTag(snapshotTag);
  for (const volume of volumes) {
    const shouldSnapshot = getTagValue(volume.Tags, snapshotTag);
    if (shouldSnapshot === 'true') {

      const volumeName = getTagValue(volume.Tags, 'Name');
      const volumeLabel = volumeName ? `${volume.VolumeId} (${volumeName})`: volume.VolumeId;
      const description = `${snapshotTag} - ${timestamp}`;

      const tags = [];
      if (volumeName) {
        tags.push({Key: 'Name', Value: volumeName});
      }
      if (purgeAfterFE > 0) {
        tags.push({Key: 'PurgeAllow', Value: 'true'});
        tags.push({Key: 'PurgeAfterFE', Value: purgeAfterFE.toString()});
      }

      let snapshot = await ec2.createSnapshot(volume.VolumeId, description);
      const snapshotId = snapshot.SnapshotId;
      if (tags) {
        await ec2.createTags(snapshotId, tags);
      }
      console.log(`Created snapshot '${snapshotId}' for volume '${volumeLabel}'.`);

      if (copyTo) {
        console.log(`Waiting for snapshot '${snapshotId}' for volume: '${volumeLabel}' to complete...`);

        while (snapshot.State === 'pending') {
          await sleep(500);
          snapshot = await ec2.getSnapshot(snapshotId);
        }

        if (snapshot.State === 'completed') {
          const clonedSnapshot = await ec2_dest.copySnapshot(snapshotId, awsRegion, copyTo, `${description} [Copied ${snapshotId} from ${awsRegion}]`);
          if (tags) {
            await ec2_dest.createTags(clonedSnapshot.SnapshotId, tags);
          }
          console.log(`Copied snapshot '${snapshotId}' for volume '${volumeLabel}' to snapshot '${clonedSnapshot.SnapshotId}' in region '${copyTo}'.`);
        } else {
          console.log(`Could not copy errored out snapshot '${snapshotId}' for volume '${volumeLabel}' to region '${copyTo}'!`);
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
