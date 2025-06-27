const express = require("express");
const axios = require("axios");
const app = express();

// Your Slack Incoming Webhook URL
// It's best to store this in the .env file in Glitch for security
const SLACK_WEBHOOK_URL = process.env.SLACK_URL;

// Tell express to automatically parse JSON bodies
app.use(express.json());

// The main endpoint that Frame.io will send webhooks to
app.post("/webhook", (req, res) => {
  const frameio_payload = req.body;
  let message_text = "";

  if (frameio_payload.type === "asset.created") {
    message_text = `🚀 *New Asset Uploaded*\n*Name:* ${frameio_payload.resource.name}\n<${frameio_payload.resource.short_url}|Click here to view>`;
  } else if (frameio_payload.type === "comment.created") {
    message_text = `💬 *New Comment*\n*Asset:* ${frameio_payload.resource.asset.name}\n*Comment:* ${frameio_payload.resource.text}\n<${frameio_payload.resource.asset.short_url}|Click here to view comment>`;
  } else {
    return res.status(200).send("Event type not handled");
  }

  // Send the formatted message to Slack
  axios.post(SLACK_WEBHOOK_URL, { text: message_text, mrkdwn: true })
    .then(() => {
      res.status(200).send("Message sent to Slack");
    })
    .catch((error) => {
      console.error("Error sending to Slack:", error);
      res.status(500).send("Error");
    });
});

// Start the server
const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
