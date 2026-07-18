const { google } = require('googleapis');
const fs = require('fs');

function getOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YT_CLIENT_ID,
    process.env.YT_CLIENT_SECRET,
    process.env.YT_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
  return oauth2Client;
}

async function uploadVideo({
  videoPath,
  title,
  description,
  tags = [],
  privacyStatus = 'public',
  thumbnailPath = null,
  categoryId = '24',
  containsSyntheticMedia = true,
}) {
  const auth = getOAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId,
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = res.data.id;

  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
  }

  return { videoId, url: `https://youtube.com/watch?v=${videoId}` };
}

module.exports = { uploadVideo };
