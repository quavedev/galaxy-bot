import { getAppLink, METRICS } from './utilities';
import { scaleApp } from './api';

const MAX_CONTAINERS = 10;
const MIN_CONTAINERS = 2;

const trySendAlertToSlack = (
  { appLink, msgTitle, lastMetric, channel, messagePrefix },
  options,
  slack
) => {
  const lastMetricsText = `${Object.entries(lastMetric)
    .filter(([key]) => !!METRICS[key])
    .map(([key, value]) => `*${key}*\n${METRICS[key].format(value)}`)
    .join('\n')}`;
  console.log(`info: sending auto scale message to Slack ${channel}`);
  slack.note({
    ...(channel ? { channel } : {}),
    text: `${
      messagePrefix ? `${messagePrefix} ` : ''
    }${appLink}\n${msgTitle}\n\n*Metrics*\n${lastMetricsText}\n`,
  });
};

const ALL_CHECKS = [
  {
    metricField: 'cpuPercentage',
    whenField: 'cpuPercentageAbove',
    greaterThan: true,
  },
  {
    metricField: 'cpuPercentage',
    whenField: 'cpuPercentageBelow',
    greaterThan: false,
  },
  {
    metricField: 'memoryPercentage',
    whenField: 'memoryPercentageAbove',
    greaterThan: true,
  },
  {
    metricField: 'memoryPercentage',
    whenField: 'memoryPercentageBelow',
    greaterThan: false,
  },
  {
    metricField: 'connections',
    whenField: 'connectionsAbove',
    greaterThan: true,
  },
  {
    metricField: 'connections',
    whenField: 'connectionsBelow',
    greaterThan: false,
  },
];

function checkResultToText(scaledSuccessChecks) {
  if (!scaledSuccessChecks) {
    throw new Error(
      `scaledSuccessChecks=${scaledSuccessChecks} should never be null or undefined here`
    );
  }
  return `${scaledSuccessChecks
    .map(c => {
      const appMetric = METRICS[c.metricField];
      return `${c.metricField} ${(appMetric &&
        appMetric.format(c.lastMetricValue)) ||
        c.lastMetricValue} is ${c.greaterThan ? 'greater than' : 'less than'} ${
        c.whenField
      } ${(appMetric && appMetric.format(c.whenValue)) || c.whenValue}`;
    })
    .join(', ')}`;
}

const checkAction = (action, rules, metricsParam, { andMode = true } = {}) => {
  const when = rules[action] || {};
  const metrics = metricsParam || [];

  const checksConfigured = ALL_CHECKS.map(check =>
    when[check.whenField] == null ? null : check
  ).filter(Boolean);
  if (!checksConfigured.length) {
    return null;
  }
  const scaledSuccessChecks = checksConfigured
    .map(check => {
      const whenValue = +when[check.whenField];
      const lastMetricValue = metrics[0][check.metricField];
      if (check.greaterThan) {
        const isGreater = metrics.every(
          metric => +metric[check.metricField] > whenValue
        );

        const text = `info: auto-scale: ${action}: ${
          check.metricField
        } ${lastMetricValue} is ${
          check.greaterThan ? 'greater than' : 'less than'
        } ${check.whenField} ${whenValue} => `;
        console.log(`${text}${isGreater ? 'YES' : 'NO'}`);
        return isGreater
          ? {
              ...check,
              lastMetricValue,
              whenValue,
            }
          : null;
      }

      const isLess = metrics.every(
        metric => +metric[check.metricField] < whenValue
      );
      const text = `info: auto-scale: ${action}: ${
        check.metricField
      } ${lastMetricValue} is ${
        check.greaterThan ? 'greater than' : 'less than'
      } ${check.whenField} ${whenValue} => `;
      console.log(`${text}${isLess ? 'YES' : 'NO'}`);
      return isLess
        ? {
            ...check,
            lastMetricValue,
            whenValue,
          }
        : null;
    })
    .filter(Boolean);

  const check = andMode
    ? scaledSuccessChecks.length === checksConfigured.length
    : scaledSuccessChecks.length > 0;

  console.log(`info: ${action} => ${check ? 'YES' : 'NO'}`);

  if (check) {
    console.log(`action: ${action} ${checkResultToText(scaledSuccessChecks)}`);
    return scaledSuccessChecks;
  }
  return null;
};

async function scale({
  api,
  data,
  scaleTo,
  adding,
  reducing,
  trySendAlert,
  options,
  reason,
}) {
  const { runningCount } = data;
  const containerCount = runningCount + (adding ? adding : -reducing);
  const direction = adding ? 'up' : 'down';
  const moreOrLess = adding ? 'more' : 'less';
  const addOrRemove = adding ? 'add' : 'remove';
  const msgTitle = `Scaling ${direction} containers to *${scaleTo}* from ${runningCount} (${adding ||
    reducing} ${moreOrLess}): ${reason}`;
  console.info(msgTitle);

  const isScalingOrUpdating = data.status === 'updating';
  if (isScalingOrUpdating) {
    console.info(
      `skip: Should ${addOrRemove} containers but already scaling from previous actions or updating to a new version`
    );
    return;
  }

  if (options.simulation) {
    console.info(`simulation: Scaling ${direction}`);
    return;
  }

  await scaleApp({ api, appId: data._id, containerCount });

  trySendAlert({ msgTitle });
}

export const autoscale = async ({ data, options, slack, api } = {}) => {
  const { autoscaleRules } = options;
  if (!autoscaleRules) return false;

  console.log('info: checking auto scaling metrics');

  const appLink = getAppLink(options);
  const { runningCount, lastMetric } = data;

  const {
    minContainers = MIN_CONTAINERS,
    maxContainers = MAX_CONTAINERS,
    containersToScale = 1,
    channel,
    messagePrefix,
  } = autoscaleRules;

  const trySendAlert = ({ msgTitle }) =>
    trySendAlertToSlack(
      {
        appLink,
        msgTitle,
        lastMetric,
        channel,
        messagePrefix,
      },
      options,
      slack
    );

  const loadingIndicatorSelector = '.drawer.arrow-third';

  if (runningCount < minContainers) {
    const adding = minContainers - runningCount;
    const msg = `Below minimum of containers, adding ${adding}`;
    console.info(`action: addingToMinimum: ${msg}`);
    await scale({
      api,
      data,
      scaleTo: minContainers,
      adding,
      loadingIndicatorSelector,
      trySendAlert,
      options,
      reason: msg,
    });
    return true;
  }

  if (runningCount > maxContainers) {
    const reducing = runningCount - maxContainers;
    const msg = `Above maximum of containers, reducing ${reducing}`;
    console.info(`action: reducingToMaximum: ${msg}`);
    await scale({
      api,
      data,
      scaleTo: maxContainers,
      reducing,
      loadingIndicatorSelector,
      trySendAlert,
      options,
      reason: msg,
    });
    return true;
  }

  const checksToAddOrNull = checkAction(
    'addWhen',
    autoscaleRules,
    data.metrics,
    {
      andMode: false,
    }
  );
  const shouldAddContainer = runningCount < maxContainers && checksToAddOrNull;

  if (shouldAddContainer) {
    const containersToAdd =
      runningCount + containersToScale > maxContainers ? 1 : containersToScale;
    const nextContainerCount = runningCount + containersToAdd;
    await scale({
      api,
      data,
      scaleTo: nextContainerCount,
      adding: containersToAdd,
      loadingIndicatorSelector,
      trySendAlert,
      options,
      reason: checkResultToText(checksToAddOrNull),
    });
    return true;
  }

  const checksToReduceOrNull = checkAction(
    'reduceWhen',
    autoscaleRules,
    data.metrics,
    { andMode: true }
  );
  const shouldReduceContainer =
    runningCount > minContainers && checksToReduceOrNull;
  if (shouldReduceContainer) {
    const containersToReduce =
      runningCount - containersToScale < minContainers ? 1 : containersToScale;
    const nextContainerCount = runningCount - containersToReduce;
    await scale({
      api,
      data,
      scaleTo: nextContainerCount,
      reducing: containersToReduce,
      loadingIndicatorSelector,
      trySendAlert,
      options,
      reason: checkResultToText(checksToReduceOrNull),
    });
    return true;
  }
  return false;
};
