import rp from 'request-promise';
import merge from 'lodash.merge';
import slackNotify from 'slack-notify';
import { getAppLink, getFormattedTimestamp, METRICS } from './utilities';
import { autoscale } from './autoscale';
import { getGalaxyApi, getMetrics } from './api';

const getSlack = options => {
  if (options.silentSlack) {
    return {
      alert(...args) {
        console.log('silent slack - alert: ', ...args);
      },
      note(...args) {
        console.log('silent slack - note', ...args);
      },
    };
  }
  if (options.slackWebhook) {
    return slackNotify(options.slackWebhook);
  }

  return {
    alert(...args) {
      console.log('no slack - alert: ', ...args);
    },
    note(...args) {
      console.log('no slack - note', ...args);
    },
  };
};

const alertAppMetricAboveMax = ({
  metricName,
  maxValue,
  data,
  slack,
  appLink,
  lastMetricsText,
  lastContainerText,
  channel,
  messagePrefix,
}) => {
  if (maxValue == null) {
    return;
  }

  console.log(`info: checking alerts about ${metricName}`);

  const metricsWithTimestamp = data.metrics
    .filter(metric => metric[metricName])
    .map(s => ({
      value: s[metricName],
      timestamp: s.timestamp,
    }));

  if (
    metricsWithTimestamp.length &&
    metricsWithTimestamp.map(c => c.value).every(v => v > maxValue)
  ) {
    const text = `Latest ${
      metricsWithTimestamp.length
    } metrics are above ${METRICS[metricName].format(maxValue)}`;
    console.log(`alert: app ${appLink}: ${text}`);
    slack.alert({
      ...(channel ? { channel } : {}),
      text: `${
        messagePrefix ? `${messagePrefix} ` : ''
      }${appLink}: application\n*${metricName}*: ${text}\n${metricsWithTimestamp
        .map(
          valueWithTimestamp =>
            `${getFormattedTimestamp(valueWithTimestamp.timestamp)}: ${METRICS[
              metricName
            ].format(valueWithTimestamp.value)}`
        )
        .join(
          '\n'
        )}\n*Metrics*\n${lastMetricsText}\n*Containers*\n${lastContainerText}`,
    });
  }
};

export const sync = async optionsParam => {
  console.log(`info: local options ${JSON.stringify(optionsParam)}`);
  const { remote } = optionsParam || {};
  let remoteOptions = {};
  if (remote && remote.url) {
    console.log(`info: getting config from remote ${remote.url}`);
    try {
      remoteOptions = JSON.parse(await rp(remote.url));
    } catch (e) {
      console.error(`Error getting remote options from ${remote.url}`, e);
    }
    console.log(`info: remote options ${JSON.stringify(remoteOptions)}`);
  }
  const options = merge(optionsParam, remoteOptions);
  console.log(`info: starting for ${options.variables.hostname}`);
  console.log(`info: options ${JSON.stringify(options)}`);

  const api = getGalaxyApi(options);
  const slack = getSlack(options);
  console.log('info: reading stored metrics');
  try {
    const data = await getMetrics({ api, options });

    const {
      infoRules: {
        send = false,
        channel: infoChannel,
        messagePrefix: infoMessagePrefix,
      } = {},
    } = options;

    const appLink = getAppLink(options);
    const { metrics, lastMetric, ...containerInfo } = data;

    if (send) {
      console.log(`info: sending note to Slack`);
      slack.note({
        ...(infoChannel ? { channel: infoChannel } : {}),
        text: `${infoMessagePrefix ? `${infoMessagePrefix} ` : ''}${appLink}`,
        attachments: [
          {
            fallback: `Check on Galaxy`,
            fields: [
              ...Object.entries(lastMetric).map(([title, value]) => ({
                title,
                value:
                  (METRICS[title] && METRICS[title].format(value)) || value,
              })),
              ...Object.entries(containerInfo).map(([title, value]) => ({
                title,
                value:
                  (METRICS[title] && METRICS[title].format(value)) || value,
              })),
            ],
          },
        ],
      });
    }

    // not enough data to send alerts
    if (data.metrics.length < options.variables.limit) {
      console.log(
        `info: minimum stats (${options.variables.limit}) is not available yet, we have ${data.metrics.length}`
      );
      return data;
    }

    const lastMetricsText = `${Object.entries(lastMetric)
      .map(
        ([key, value]) =>
          `${key}: ${(METRICS[key] && METRICS[key].format(value)) || value}`
      )
      .join('\n')}`;
    const lastContainerText = `${Object.entries(containerInfo)
      .map(
        ([key, value]) =>
          `${key}: ${(METRICS[key] && METRICS[key].format(value)) || value}`
      )
      .join('\n')}`;

    const {
      alertRules: {
        maxInApp = [],
        channel: alertChannel,
        messagePrefix: alertMessagePrefix,
      } = {},
    } = options;

    console.log(
      `info: checking alerts for app name=${options.variables.hostname}`
    );
    Object.entries(maxInApp).forEach(([metricName, maxValue]) => {
      alertAppMetricAboveMax({
        metricName,
        maxValue,
        data,
        slack,
        appLink,
        lastMetricsText,
        lastContainerText,
        channel: alertChannel,
        messagePrefix: alertMessagePrefix,
      });
    });

    await autoscale({ data, options, slack, api });

    return data;
  } catch (err) {
    console.error('Error syncing', err);
    console.log(`failed: error for ${options.variables.hostname}`);
    throw err;
  } finally {
    console.log(`info: finished for ${options.variables.hostname}`);
  }
};
