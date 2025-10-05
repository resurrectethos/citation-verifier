
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(cors());

// In-memory store for user tokens and usage
const users = {
  'user1-token': { usage: 0 },
  'user2-token': { usage: 0 },
  // Add more users here
};

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const PORT = process.env.PORT || 3001;

app.post('/api/analyze', async (req, res) => {
  const { token, text } = req.body;

  // 1. Authenticate the user
  if (!token || !users[token]) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  const user = users[token];

  // 2. Check usage limit
  if (user.usage >= 2) {
    return res.status(429).json({ error: 'Usage limit exceeded. You can only analyze up to 2 articles.' });
  }

  // 3. Call the DeepSeek API
  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: text }],
        max_tokens: 8000,
        temperature: 0.1,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API request failed: ${response.status}`);
    }

    const data = await response.json();
    const analysisResult = data.choices[0].message.content;

    // 4. Increment user's usage
    user.usage++;

    res.json({ analysis: analysisResult });

  } catch (error) {
    console.error('Error calling DeepSeek API:', error);
    res.status(500).json({ error: 'An error occurred while analyzing the text.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
