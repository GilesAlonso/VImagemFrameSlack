const express = require('express');
const axios = require('axios');
const app = express();

// This is the port Render will use.
const PORT = process.env.PORT || 3000;

// Get the Slack Webhook URL from the environment variables we will set in Render.
// This is more secure than pasting the URL directly in the code.
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Middleware to automatically parse incoming JSON from Frame.io
app.use(express.json());

// Health check endpoint for Render to see if the service is alive.
app.get('/', (req, res) => {
  res.status(200).send('Frame.io to Slack integration is running!');
});

// This is the main endpoint that will receive webhooks from Frame.io.
app.post('/webhook', async (req, res) => {
  // Check if the Slack URL is configured.
  if (!SLACK_WEBHOOK_URL) {
    console.error('Slack Webhook URL is not configured.');
    return res.status(500).send('Internal configuration error.');
  }

  const frameio_payload = req.body;
  let message_text = '';

  // Format the message based on the event type from Frame.io.
  if (frameio_payload.type === 'asset.created') {
    const resource = frameio_payload.resource;
    message_text = `🚀 *New Asset Uploaded to Frame.io*\n*Name:* ${resource.name}\n<${resource.short_url}|Click here to view>`;
  } else if (frameio_payload.type === 'comment.created') {
    const resource = frameio_payload.resource;
    const asset_url = resource.asset ? resource.asset.short_url : '#';
    const asset_name = resource.asset ? resource.asset.name : 'Unknown Asset';
    message_text = `💬 *New Comment in Frame.io*\n*Asset:* ${asset_name}\n*Comment:* ${resource.text}\n<${asset_url}|Click here to view>`;
  } else {
    // Acknowledge other events without sending to Slack to avoid errors.
    return res.status(200).send('Event type not handled, but acknowledged.');
  }

  // Try to send the formatted message to your Slack channel.
  try {
    await axios.post(SLACK_WEBHOOK_URL, {
      text: message_text,
      mrkdwn: true, // Allow formatting like bold and links in Slack.
    });
    res.status(200).send('Message successfully forwarded to Slack.');
  } catch (error) {
    console.error('Error sending message to Slack:', error.message);
    res.status(500).send('Error forwarding message to Slack.');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
