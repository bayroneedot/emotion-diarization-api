import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';
import FormData from 'form-data';

dotenv.config();
const app = express();
app.use(express.json());

const ASSEMBLY_API_KEY = process.env.ASSEMBLY_API_KEY;

app.post('/analyze', async (req, res) => {
  const { mp3Url } = req.body;
  if (!mp3Url) return res.status(400).json({ error: 'Missing mp3Url' });

  const audioPath = `./audio/audio.mp3`;
  const wavPath = `./audio/audio.wav`;

  try {
    // Download MP3
    const response = await axios({ url: mp3Url, responseType: 'stream' });
    await fs.promises.mkdir('./audio', { recursive: true });
    const writer = fs.createWriteStream(audioPath);
    response.data.pipe(writer);
    await new Promise(resolve => writer.on('finish', resolve));

    // Convert to WAV (for pyAudioAnalysis)
    await new Promise((resolve, reject) => {
      exec(`ffmpeg -y -i ${audioPath} -ar 16000 -ac 1 ${wavPath}`, err => {
        if (err) return reject('Error converting to WAV');
        resolve();
      });
    });

    // Run Python emotion analysis
    const emotionData = await new Promise((resolve, reject) => {
      exec(`python3 emotion_analysis.py ${wavPath}`, (err, stdout) => {
        if (err) return reject(err);
        resolve(JSON.parse(stdout));
      });
    });

    // Upload to AssemblyAI
    const uploadRes = await axios({
      method: 'post',
      url: 'https://api.assemblyai.com/v2/upload',
      headers: { authorization: ASSEMBLY_API_KEY },
      data: fs.createReadStream(audioPath)
    });
    const audioUrl = uploadRes.data.upload_url;

    // Request transcription with diarization
    const transcriptRes = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: audioUrl, speaker_labels: true },
      { headers: { authorization: ASSEMBLY_API_KEY } }
    );
    const transcriptId = transcriptRes.data.id;

    // Poll until completed
    let transcript;
    while (true) {
      const check = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        { headers: { authorization: ASSEMBLY_API_KEY } }
      );
      if (check.data.status === 'completed') {
        transcript = check.data;
        break;
      } else if (check.data.status === 'error') {
        return res.status(500).json({ error: 'Transcription failed' });
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    // Combine speaker and emotion (simple matching by time)
    const result = transcript.words.map(word => {
      const emotion = emotionData.find(e => 
        word.start / 1000 >= e.start && word.start / 1000 <= e.end
      )?.emotion || 'unknown';
      return {
        start: word.start / 1000,
        end: word.end / 1000,
        speaker: word.speaker,
        emotion,
        word: word.text
      };
    });

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
