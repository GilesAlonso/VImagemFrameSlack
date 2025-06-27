const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;

// --- Load required credentials from Render's Environment Variables ---
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ADOBE_CLIENT_ID = process.env.ADOBE_CLIENT_ID;
const ADOBE_CLIENT_SECRET = process.env.ADOBE_CLIENT_SECRET;

// --- In-memory cache for the Access Token ---
let accessToken = null;
let tokenExpiry = null;

/**
 * Gets a valid Adobe Access Token using the correct Server-to-Server flow.
 */
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  console.log('Generating new Server-to-Server access token...');
  try {
    const response = await axios.post('https://ims-na1.adobelogin.com/ims/token/v3', new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: ADOBE_CLIENT_ID,
      client_secret: ADOBE_CLIENT_SECRET,
      scope: 'openid,frame.s2s.all' // The correct scope for S2S
    }));

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Set expiry with a 1-min buffer

    console.log('Successfully generated new token.');
    return accessToken;

  } catch (error) {
    console.error('CRITICAL: Could not generate S2S token.', error.response ? error.response.data : error.message);
    throw new Error('Could not authenticate with Adobe. This is likely a licensing issue in the Adobe Admin Console.');
  }
}

// --- Create a dedicated API client for Frame.io (this logic remains the same) ---
const frameioApi = axios.create({ baseURL: 'https://api.frame.io/v4' });
frameioApi.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

// The rest of the application (getProjectName, the /webhook handler) is unchanged.
// Paste the functions for `getProjectName` and the `app.post('/webhook', ...)` route here
// from our previous correct versions. They do not need to be modified.

async function getProjectName(projectId) {
  if (!projectId) return 'Unknown Project';
  try {
    const response = await frameioApi.get(`/projects/${projectId}`);
    return response.data.name;
  } catch (error) {
    console.error(`Error fetching project name for ID ${projectId}:`, error.message);
    return 'Unknown Project';
  }
}

app.use(express.json());

app.post('/webhook', async (req, res) => {
  if (!SLACK_WEBHOOK_URL) {
    console.error('FATAL: SLACK_WEBHOOK_URL is not configured.');
    return res.status(500).send('Internal configuration error.');
  }

  const frameio_payload = req.body;
  let slackBlocks = [];

  try {
    if (frameio_payload.type === 'comment.created') {
      const resource = frameio_payload.resource;
      const projectName = await getProjectName(resource.project_id);
      const commenterName = resource.owner.name;
      const assetName = resource.asset.name;
      const timestamp = new Date(resource.timestamp * 1000).toISOString().substr(11, 8);
      const commentText = resource.text;
      const thumbnailUrl = resource.asset.thumbnail_url;

      slackBlocks = [
        { "type": "context", "elements": [{ "type": "mrkdwn", "text": `*${projectName}*` }] },
        { "type": "section", "text": { "type": "mrkdwn", "text": `*${commenterName}* commented on *${assetName}*\n\`${timestamp}\` ${commentText}` } },
        { "type": "image", "image_url": thumbnailUrl, "alt_text": "Video thumbnail" },
        { "type": "divider" }
      ];
    } else if (frameio_payload.type === 'asset.created') {
      const resource = frameio_payload.resource;
      const projectName = await getProjectName(resource.project_id);
      const uploaderName = resource.owner ? resource.owner.name : 'A user';
      const assetName = resource.name;
      const thumbnailUrl = resource.thumbnail_url;
      const assetSize = resource.filesize ? `(${(resource.filesize / 1024 / 1024).toFixed(2)} MB)` : '';

      slackBlocks = [
        { "type": "context", "elements": [{ "type": "mrkdwn", "text": `*${projectName}*` }] },
        { "type": "section", "text": { "type": "mrkdwn", "text": `*${uploaderName}* uploaded a new asset: *<${resource.short_url}|${assetName}>* ${assetSize}` } },
        { "type": "image", "image_url": thumbnailUrl, "alt_text": "Video thumbnail" },
        { "type": "divider" }
      ];
    } else {
      return res.status(200).send('Event type not handled, but acknowledged.');
    }

    await axios.post(SLACK_WEBHOOK_URL, { blocks: slackBlocks });
    res.status(200).send('Message successfully forwarded to Slack.');

  } catch (error) {
    console.error('Error processing webhook event:', error.message);
    res.status(500).send('Error processing request.');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
