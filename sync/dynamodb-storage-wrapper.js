/**
 * DynamoDB-backed storage wrapper implementing Split's pluggable storage interface.
 * Replaces the Cloudflare Durable Object (SplitStorage) + SplitStorageWrapper.
 *
 * Table layout: PK = partitionKey (constant), SK = key (storage key), v = value (string/number/JSON).
 * For getKeysByPrefix we Query with SK begins_with prefix.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
} = require('@aws-sdk/lib-dynamodb');

const DEFAULT_PK = 'DATA';

/**
 * @param {Object} options
 * @param {string} options.tableName - DynamoDB table name
 * @param {string} [options.partitionKey=DEFAULT_PK] - Partition key value for all items
 * @param {DynamoDBClient} [options.client] - Optional DynamoDB client (for tests)
 * @returns {import("@splitsoftware/splitio-commons/src/storages/types").IPluggableStorageWrapper}
 */
function DynamoDBStorageWrapper(options) {
  const { tableName, partitionKey = DEFAULT_PK, client } = options;
  const docClient = client
    ? DynamoDBDocumentClient.from(client)
    : DynamoDBDocumentClient.from(new DynamoDBClient({}));

  function getItem(key) {
    return docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: partitionKey, sk: key },
      })
    ).then((out) => (out.Item && out.Item.v !== undefined ? out.Item.v : null));
  }

  function setItem(key, value) {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    return docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: { pk: partitionKey, sk: key, v },
      })
    ).then(() => true);
  }

  return {
    async get(key) {
      return getItem(key);
    },

    async set(key, value) {
      return setItem(key, value);
    },

    async getAndSet(key, value) {
      const prev = await getItem(key);
      await setItem(key, value);
      return prev;
    },

    async del(key) {
      await docClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: partitionKey, sk: key },
        })
      );
      return true;
    },

    async getKeysByPrefix(prefix) {
      const out = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': partitionKey, ':prefix': prefix },
          ProjectionExpression: 'sk',
        })
      );
      return (out.Items || []).map((i) => i.sk);
    },

    async getMany(keys) {
      if (keys.length === 0) return [];
      const uniq = [...new Set(keys)];
      const items = await docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName]: {
              Keys: uniq.map((sk) => ({ pk: partitionKey, sk })),
            },
          },
        })
      );
      const map = new Map();
      const list = items.Responses?.[tableName] || [];
      for (const item of list) {
        if (item.v !== undefined) map.set(item.sk, item.v);
      }
      return keys.map((k) => (map.has(k) ? map.get(k) : null));
    },

    async incr(key, increment = 1) {
      const prev = await getItem(key);
      const next = (Number(prev) || 0) + increment;
      await setItem(key, next);
      return next;
    },

    async decr(key, decrement = 1) {
      const prev = await getItem(key);
      const next = (Number(prev) || 0) - decrement;
      await setItem(key, next);
      return next;
    },

    async itemContains(key, item) {
      const raw = await getItem(key);
      if (!raw) return false;
      try {
        const set = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const arr = Array.isArray(set) ? set : (set && set.values ? Array.from(set.values()) : []);
        return arr.includes(item);
      } catch {
        return false;
      }
    },

    async addItems(key, items) {
      const raw = await getItem(key);
      const arr = raw ? (Array.isArray(raw) ? [...raw] : (typeof raw === 'string' ? JSON.parse(raw) : [])) : [];
      const set = new Set(arr);
      items.forEach((i) => set.add(i));
      await setItem(key, JSON.stringify([...set]));
      return true;
    },

    async removeItems(key, items) {
      const raw = await getItem(key);
      if (!raw) return true;
      const arr = Array.isArray(raw) ? [...raw] : (typeof raw === 'string' ? JSON.parse(raw) : []);
      const set = new Set(arr);
      items.forEach((i) => set.delete(i));
      await setItem(key, JSON.stringify([...set]));
      return true;
    },

    async getItems(key) {
      const raw = await getItem(key);
      if (!raw) return [];
      try {
        const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    },

    async connect() {},
    async disconnect() {},

    async pushItems() {},
    async popItems() {
      return [];
    },
    async getItemsCount() {
      return 0;
    },
  };
}

module.exports = { DynamoDBStorageWrapper, DEFAULT_PK };
