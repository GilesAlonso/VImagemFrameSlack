const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;

// --- Load all necessary credentials from Render's Environment Variables ---
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ADOBE_CLIENT_ID = process.env.ADOBE_CLIENT_ID;
const ADOBE_CLIENT_SECRET = process.env.ADOBE_CLIENT_SECRET;
const ADOBE_REFRESH_TOKEN = process.env.ADOBE_REFRESH_TOKEN;

// --- In-memory cache for the temporary Access Token ---
// This prevents us from requesting a new token for every single API call.
let accessToken = null;
let tokenExpiry = null;

/**
 * Gets a valid Adobe Access Token, refreshing it if it's expired or missing.
 * This is the core of the authentication logic.
 */
async function getAccessToken() {
  // If we have a valid token in memory, reuse it.
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  console.log('Access token is missing or expired. Refreshing now...');
  try {
    const response = await axios.post('https://ims-na1.adobelogin.com/ims/token', new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: ADOBE_CLIENT_ID,
      client_secret: ADOBE_CLIENT_SECRET,
      refresh_token: ADOBE_REFRESH_TOKEN
    }));

    accessToken = response.data.access_token;
    // Set expiry to 1 hour from now (Adobe tokens last 24 hours, but we refresh early for safety).
    tokenExpiry = Date.now() + (60 * 60 * 1000); 
    
    console.log('Successfully refreshed Adobe access token.');
    return accessToken;

  } catch (error) {
    console.error('CRITICAL: Could not refresh Adobe token. Check environment variables.', error.response ? error.response.data : error.message);
    throw new Error('Could not authenticate with Adobe.');
  }
}

// --- Create a dedicated API client for Frame.io ---
// This will automatically add the authentication token to every request.
const frameioApi = axios.create({ baseURL: 'https://api.frame.io/v4' });
frameioApi.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));


/**
 * Fetches the Project Name from the Frame.io API using a project_id.
 */
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

// --- Main application logic ---
app.use(express.json());

// This is the main endpoint that will receive webhooks from Frame.io.
app.post('/webhook', async (req, res) => {
  if (!SLACK_WEBHOOK_URL) {
    console.error('FATAL: SLACK_WEBHOOK_URL is not configured in environment variables.');
    return res.status(500).send('Internal configuration error.');
  }

  const frameio_payload = req.body;
  let slackBlocks = []; // We will build our Slack message using Block Kit.

  try {
    // --- Handler for New Comments ---
    if (frameio_payload.type === 'comment.created') {
      const resource = frameio_payload.resource;
      const projectName = await getProjectName(resource.project_id);
      const commenterName = resource.owner.name;
      const assetName = resource.asset.name;
      // Frame.io timestamps are in seconds; convert to HH:MM:SS format
      const timestamp = new Date(resource.timestamp * 1000).toISOString().substr(11, 8);
      const commentText = resource.text;
      const thumbnailUrl = resource.asset.thumbnail_url;

      slackBlocks = [
        { "type": "context", "elements": [{ "type": "mrkdwn", "text": `*${projectName}*` }] },
        { "type": "section", "text": { "type": "mrkdwn", "text": `*${commenterName}* commented on *${assetName}*\n\`${timestamp}\` ${commentText}` } },
        { "type": "image", "image_url": thumbnailUrl, "alt_text": "Video thumbnail" },
        { "type": "divider" }
      ];
    }
    // --- Handler for New Asset Uploads ---
    else if (frameio_payload.type === 'asset.created') {
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
    }
     else {
      // Acknowledge other events without sending to Slack to avoid errors.
      return res.status(200).send('Event type not handled, but acknowledged.');
    }

    // Send the structured message to our Slack channel.
    await axios.post(SLACK_WEBHOOK_URL, { blocks: slackBlocks });
    res.status(200).send('Message successfully forwarded to Slack.');

  } catch (error) {
    console.error('Error processing webhook event:', error.message);
    res.status(500).send('Error processing request.');
  }
});

// Start the server.
app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
