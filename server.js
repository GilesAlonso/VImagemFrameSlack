const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;

// We now need two secrets: one for Slack and one for the Frame.io API token.
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const FRAMEIO_TOKEN = process.env.FRAMEIO_TOKEN;

// Configure the axios instance for calling the Frame.io API
const frameioApi = axios.create({
  baseURL: 'https://api.frame.io/v4',
  headers: { 'Authorization': `Bearer ${FRAMEIO_TOKEN}` }
});

// Middleware to parse incoming JSON
app.use(express.json());

// --- Helper Functions to Format Data ---

// Converts seconds (e.g., 75.1) into HH:MM:SS:FF format
function formatTimestamp(seconds, frameRate) {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = Math.floor(seconds % 60);
  const ff = Math.floor((seconds - Math.floor(seconds)) * frameRate);

  return [hh, mm, ss].map(v => v.toString().padStart(2, '0')).join(':') + ':' + ff.toString().padStart(2, '0');
}

// Fetches the Project Name from the Frame.io API using a project_id
async function getProjectName(projectId) {
  if (!FRAMEIO_TOKEN || !projectId) {
    return 'Unknown Project';
  }
  try {
    const response = await frameioApi.get(`/projects/${projectId}`);
    return response.data.name;
  } catch (error) {
    console.error('Error fetching project name:', error.message);
    return 'Unknown Project'; // Return a default name on error
  }
}


// --- Main Webhook Endpoint ---

app.post('/webhook', async (req, res) => {
  if (!SLACK_WEBHOOK_URL) {
    console.error('Slack Webhook URL is not configured.');
    return res.status(500).send('Internal configuration error.');
  }

  const frameio_payload = req.body;
  let slackBlocks = [];

  try {
    // --- Handler for New Comments ---
    if (frameio_payload.type === 'comment.created') {
      const resource = frameio_payload.resource;
      const projectName = await getProjectName(resource.project_id);
      const commenterName = resource.owner.name;
      const assetName = resource.asset.name;
      const timestamp = formatTimestamp(resource.timestamp, resource.asset.fps);
      const commentText = resource.text;
      const thumbnailUrl = resource.asset.thumbnail_url;

      slackBlocks = [
        {
          "type": "context",
          "elements": [{ "type": "mrkdwn", "text": `*${projectName}*` }]
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": `*${commenterName}* commented on *${assetName}*\n\`${timestamp}\` ${commentText}`
          }
        },
        {
          "type": "image",
          "image_url": thumbnailUrl,
          "alt_text": "Video thumbnail"
        },
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

      slackBlocks = [
        {
          "type": "context",
          "elements": [{ "type": "mrkdwn", "text": `*${projectName}*` }]
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": `*${uploaderName}* uploaded a new asset: *<${resource.short_url}|${assetName}>*`
          }
        },
        {
          "type": "image",
          "image_url": thumbnailUrl,
          "alt_text": "Video thumbnail"
        },
        { "type": "divider" }
      ];
    }
     else {
      return res.status(200).send('Event type not handled, but acknowledged.');
    }

    // Send the structured message to Slack
    await axios.post(SLACK_WEBHOOK_URL, { blocks: slackBlocks });
    res.status(200).send('Message successfully forwarded to Slack.');

  } catch (error) {
    console.error('Error processing request:', error.message);
    res.status(500).send('Error processing request.');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
