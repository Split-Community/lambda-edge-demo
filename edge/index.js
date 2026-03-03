/**
 * Lambda@Edge (viewer-request): full Split SDK in consumer_partial mode.
 * Reads rollout plan from DynamoDB (nearest Global Table replica when edge runs in a replica region; else fallback),
 * evaluates getTreatment(key, featureFlag). Returns 200 with HTML showing redirect target and processing time.
 */

const { SplitFactory, PluggableStorage, DebugLogger } = require('@splitsoftware/splitio-browserjs');
const { DynamoDBStorageWrapper } = require('./dynamodb-storage-wrapper');

const SDK_LOG_PREFIX = '[split]';
const SDK_LOG_CAPTURE_MAX = 80;

function createSplitLogger(capture) {
  function log(level, method, message) {
    const line = `${SDK_LOG_PREFIX} ${message}`;
    if (method === 'error') console.error(line);
    else if (method === 'warn') console.warn(line);
    else console.log(line);
    if (capture && capture.length < SDK_LOG_CAPTURE_MAX) {
      capture.push({ level, message: String(message).slice(0, 500) });
    }
  }
  return {
    debug: (msg) => log('DEBUG', 'log', msg),
    info: (msg) => log('INFO', 'log', msg),
    warn: (msg) => log('WARN', 'warn', msg),
    error: (msg) => log('ERROR', 'error', msg),
  };
}

let config = {};
try {
  config = require('./config.json');
} catch (_) {}

const TABLE_NAME = config.TABLE_NAME || '';
const STORAGE_PK = config.STORAGE_PK || 'DATA';
const SPLIT_SDK_KEY = config.SPLIT_SDK_KEY || '';
const FEATURE_FLAG_NAME = config.FEATURE_FLAG_NAME || 'my_feature';
/** Regions where the DynamoDB Global Table has replicas (primary + replica list). Edge may run in other regions. */
const REPLICA_REGIONS = Array.isArray(config.REPLICA_REGIONS) && config.REPLICA_REGIONS.length
  ? config.REPLICA_REGIONS
  : ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-northeast-1'];
const REDIRECT_ON = 'https://google.com';
const REDIRECT_OFF = 'https://apple.com';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlResponse(url, durationMs, treatment, key, diagnostic) {
  const diagHtml = diagnostic
    ? `<h2>Diagnostic (treatment was &quot;control&quot;)</h2><pre>${escapeHtml(JSON.stringify(diagnostic, null, 2))}</pre>`
    : '';
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Edge redirect</title></head>
<body>
  <h1>Redirect target</h1>
  <p><strong>Would redirect to:</strong> <a href="${url}">${url}</a></p>
  <p><strong>Processing time:</strong> ${durationMs} ms</p>
  <p><strong>Treatment:</strong> ${treatment}</p>
  <p><strong>Key:</strong> ${key}</p>
  ${diagHtml}
</body>
</html>`;
  return {
    status: '200',
    statusDescription: 'OK',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    bodyEncoding: 'base64',
    body: Buffer.from(html, 'utf8').toString('base64'),
  };
}

exports.handler = async function handler(event) {
  const startMs = Date.now();
  const request = event.Records?.[0]?.cf?.request;
  if (!request) {
    return { status: '500', statusDescription: 'Bad event' };
  }

  if (!TABLE_NAME || !SPLIT_SDK_KEY) {
    const durationMs = Date.now() - startMs;
    console.log(JSON.stringify({ event: 'redirect', durationMs, treatment: 'off', reason: 'missing_config' }));
    return htmlResponse(REDIRECT_OFF, durationMs, 'off', 'default');
  }

  // Use execution region only if we have a Global Table replica there; else fallback (avoids ResourceNotFoundException)
  const executionRegion = process.env.AWS_REGION || 'us-east-1';
  const region = REPLICA_REGIONS.includes(executionRegion) ? executionRegion : REPLICA_REGIONS[0];

  const wrapper = DynamoDBStorageWrapper({
    tableName: TABLE_NAME,
    partitionKey: STORAGE_PK,
    region,
  });

  const qs = request.querystring || '';
  const key = (qs && new URLSearchParams(qs).get('key')) || 'default';

  const sdkLogCapture = [];
  const splitLogger = createSplitLogger(sdkLogCapture);

  const factory = SplitFactory({
    core: {
      authorizationKey: SPLIT_SDK_KEY,
      key,
    },
    mode: 'consumer_partial',
    storage: PluggableStorage({ wrapper }),
    debug: DebugLogger(),
    logger: splitLogger,
  });

  const client = factory.client();
  let treatment = 'off';
  let ready = false;
  let readyError = null;
  try {
    await client.whenReady();
    ready = true;
  } catch (e) {
    readyError = e && e.message ? e.message : String(e);
    console.warn(JSON.stringify({ event: 'split_not_ready', error: readyError, featureFlag: FEATURE_FLAG_NAME, key }));
  }
  try {
    treatment = await client.getTreatment(FEATURE_FLAG_NAME);
  } catch (e) {
    console.error(JSON.stringify({ event: 'getTreatment_error', error: (e && e.message) || String(e), featureFlag: FEATURE_FLAG_NAME, key }));
  } finally {
    client.destroy();
  }

  const rawTreatment = treatment;
  treatment = String(treatment || 'off').toLowerCase();
  if (rawTreatment === 'control') {
    try {
      const splitKeys = await wrapper.getKeysByPrefix('SPLITIO.splits.');
      console.log(JSON.stringify({ event: 'storage_diagnostic', featureFlag: FEATURE_FLAG_NAME, splitKeysInStorage: splitKeys }));
    } catch (e) {
      console.warn(JSON.stringify({ event: 'storage_diagnostic_error', error: (e && e.message) || String(e) }));
    }
  }

  const url = treatment === 'on' ? REDIRECT_ON : REDIRECT_OFF;
  const durationMs = Date.now() - startMs;

  console.log(JSON.stringify({
    event: 'redirect',
    durationMs,
    region,
    key,
    featureFlag: FEATURE_FLAG_NAME,
    ready,
    readyError: readyError || undefined,
    rawTreatment,
    treatment,
    url,
  }));
  if (sdkLogCapture.length > 0) {
    console.log(JSON.stringify({ event: 'split_sdk_logs', lines: sdkLogCapture }));
  }
  return htmlResponse(url, durationMs, treatment, key, rawTreatment === 'control' ? { ready, readyError, rawTreatment, sdkLogs: sdkLogCapture.slice(-20) } : undefined);
};
