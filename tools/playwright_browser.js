'use strict';

const { chromium } = require('playwright');

function browserChannel(browser = process.env.ARCAIA_BROWSER || 'edge') {
  const normalized = String(browser).trim().toLowerCase();
  if (normalized === 'edge') return 'msedge';
  if (normalized === 'chrome') return 'chrome';
  throw new Error('ARCAIA_BROWSER must be edge or chrome');
}

function launchBrowser(options = {}) {
  return chromium.launch({ ...options, channel: browserChannel() });
}

module.exports = { browserChannel, launchBrowser };
