export const getPercentualNumber = txt => parseInt(txt.replace('%', ''), 10);

export const getFormattedTimestamp = timestamp =>
  `<!date^${timestamp}^{date_short_pretty} at {time_secs}|${timestamp}>`;

export const getGalaxyUrl = options =>
  `https://galaxy.meteor.com/app/${options.variables.hostname}/containers`;

export const getAppLink = options => {
  const appUrl = getGalaxyUrl(options);
  return `${options.variables.hostname} - <${appUrl}|see on Galaxy>`;
};

export const METRICS = {
  memoryPercentage: {
    parse: getPercentualNumber,
    format: value => `${value.toFixed(1)}%`,
  },
  cpuPercentage: {
    parse: getPercentualNumber,
    format: value => `${value.toFixed(1)}%`,
  },
  connections: {
    parse: value => +value,
    format: value => `${value}`,
  },
};
