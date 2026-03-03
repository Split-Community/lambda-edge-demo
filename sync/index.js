/**
 * Sync Lambda: runs Split Synchronizer only.
 * Writes rollout plan to DynamoDB (Global Table) via DynamoDB wrapper.
 * Lambda@Edge uses the full Split SDK to evaluate getTreatment at the edge from this data.
 */

const { Synchronizer } = require('@splitsoftware/splitio-sync-tools');
const { DynamoDBStorageWrapper } = require('./dynamodb-storage-wrapper');

const TABLE_NAME = process.env.TABLE_NAME || '';
const SDK_KEY = process.env.SPLIT_SDK_KEY || '';

async function runSynchronizer(wrapper) {
  return new Promise((resolve, reject) => {
    const synchronizer = new Synchronizer({
      core: { authorizationKey: SDK_KEY },
      storage: { type: 'PLUGGABLE', wrapper },
      debug: 'ERROR',
    });
    synchronizer.execute((err) => (err ? reject(err) : resolve()));
  });
}

exports.handler = async function handler() {
  if (!TABLE_NAME || !SDK_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing TABLE_NAME or SPLIT_SDK_KEY' }) };
  }

  const wrapper = DynamoDBStorageWrapper({ tableName: TABLE_NAME });

  try {
    await runSynchronizer(wrapper);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: 'Synchronization finished' }),
    };
  } catch (err) {
    console.error('Sync failed', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err.message) }),
    };
  }
};
