import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { Configuration, StreamingAvatarApi } from '@heygen/streaming-avatar';
import './index.css';

const API_KEY = 'NWU4NWY2ZTVmZjQ1NGIyMDlkNWQ1YzgxOGZkYjMzNTQtMTcxODI1ODc4Mw==';

const App = () => {
  const [avatars, setAvatars] = useState([]);
  const [voices, setVoices] = useState([]);
  const [avatarId, setAvatarId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [debug, setDebug] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const videoRef = useRef(null);
  const avatarApi = useRef(null);
  const recognition = useRef(null);
  const peerConnection = useRef(null);
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    const fetchAvatars = async () => {
      try {
        const response = await axios.get('https://ai-streaming-oymd.vercel.app/api/avatars');
        setAvatars(response.data.data.avatars);
        setAvatarId(response.data.data.avatars[0]?.avatar_id || '');
      } catch (error) {
        console.error('Error fetching avatars:', error);
        setDebug('Error fetching avatars: ' + error.message);
      }
    };

    const fetchVoices = async () => {
      try {
        const response = await axios.get('https://ai-streaming-oymd.vercel.app/api/voices');
        setVoices(response.data.data.voices);
        setVoiceId(response.data.data.voices[1]?.voice_id || '');
      } catch (error) {
        console.error('Error fetching voices:', error);
        setDebug('Error fetching voices: ' + error.message);
      }
    };

    fetchAvatars();
    fetchVoices();
  }, []);

  useEffect(() => {
    const createStreamingToken = async () => {
      try {
        const response = await axios.post('https://ai-streaming-oymd.vercel.app/api/create-streaming-token', {}, {
          headers: {
            'X-Api-Key': API_KEY,
            'Content-Type': 'application/json'
          }
        });
        const tokenData = response.data.data.token;
        avatarApi.current = new StreamingAvatarApi(new Configuration({ accessToken: tokenData }));
      } catch (error) {
        console.error('Error creating streaming token:', error);
        setDebug('Error creating streaming token: ' + error.message);
      }
    };

    createStreamingToken();
  }, []);

  useEffect(() => {
    async function sessionHandler() {
      if (avatarId && voiceId && !isStreaming) {
        await stopAllSessions();
        startStreaming();
      }
    }
    sessionHandler();
  }, [avatarId, voiceId]);

  const startStreaming = async () => {
    try {
      setIsStreaming(true);
      const { sdp, session_id } = await createNewSession(avatarId, voiceId);
      setSessionId(session_id);
      setSessionInfo({ sdp, session_id });
      await startStreamingSession(session_id, sdp);
    } catch (error) {
      console.error('Error starting streaming:', error);
      setDebug('Error starting streaming: ' + error.message);
      setIsStreaming(false);
    }
  };

  const startStreamingSession = async (sessionId, sdp) => {
    try {
      const requestBody = {
        session_id: sessionId,
        sdp: {
          type: sdp.type,
          sdp: sdp.sdp
        }
      };

      const response = await fetch('https://api.heygen.com/v1/streaming.start', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': API_KEY,
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorResponse = await response.json();
        console.error('Error Response:', errorResponse);
        throw new Error(`Error: ${response.status} - ${response.statusText}`);
      }

      const res = await response.json();
      videoRef.current.srcObject = new MediaStream();
      videoRef.current.onloadedmetadata = () => {
        videoRef.current.play();
        setDebug('Streaming started');
      };

    } catch (error) {
      console.error('Error starting streaming session:', error);
      setDebug('Error starting streaming session: ' + error.message);
      setIsStreaming(false);
    }
  };

  const createNewSession = async (avatarName, voiceId) => {
    try {
      const response = await fetch('https://api.heygen.com/v1/streaming.new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': API_KEY,
        },
        body: JSON.stringify({
          quality: 'high',
          avatar_name: avatarName,
          voice: { voice_id: voiceId },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create a new session');
      }

      const data = await response.json();
      const { sdp: serverSdp, ice_servers2: iceServers, session_id } = data.data;


      const formattedIceServers = iceServers.map(iceServer => ({
        urls: iceServer.urls,
        username: iceServer.username || '',
        credential: iceServer.credential || ''
      }));
      console.log('ICE Servers:', data.data);
      peerConnection.current = new RTCPeerConnection({ iceServers: formattedIceServers });

      peerConnection.current.ontrack = (event) => {
        console.log('On Track Event:', event);
        if (event.track.kind === 'audio' || event.track.kind === 'video') {
          const mediaStream = new MediaStream();
          mediaStream.addTrack(event.track);
          videoRef.current.srcObject = mediaStream;
        }
      };

      const remoteDescription = new RTCSessionDescription(serverSdp);
      await peerConnection.current.setRemoteDescription(remoteDescription);

      const localDescription = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(localDescription);

      peerConnection.onicecandidate = ({ candidate }) => {
        if (candidate) {
          handleICE(session_id, candidate.toJSON());
        }
      };

      return {
        sdp: {
          type: localDescription.type,
          sdp: localDescription.sdp,
        },
        session_id,
      };
    } catch (error) {
      console.error('Error creating new session:', error);
      throw error;
    }
  };

  const handleICE = async (sessionId, candidate) => {
    try {
      console.log({candidate});
      const response = await fetch('https://api.heygen.com/v1/streaming.ice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': API_KEY,
        },
        body: JSON.stringify({ session_id: sessionId, candidate }),
      });

      if (!response.ok) {
        throw new Error('Failed to handle ICE candidate');
      }

      return await response.json();
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
      throw error;
    }
  };

  const stopAllSessions = async () => {
    try {
      const response = await fetch('https://api.heygen.com/v1/streaming.list', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': API_KEY,
        }
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status} - ${response.statusText}`);
      }

      const sessions = await response.json();
      if (Array.isArray(sessions.data.sessions)) {
        for (const session of sessions.data.sessions) {
          await stopSession(session.session_id);
        }
      }
    } catch (error) {
      console.error('Error stopping all sessions:', error);
      setDebug('Error stopping all sessions: ' + error.message);
    }
  };

  const stopSession = async (sessionId) => {
    try {
      await fetch(`https://api.heygen.com/v1/streaming.stop`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': API_KEY,
        },
        body: JSON.stringify({ session_id: sessionId })
      });

      setDebug(`Session ${sessionId} stopped`);
    } catch (error) {
      console.error('Error stopping session:', error);
      setDebug('Error stopping session: ' + error.message);
    }
  };

  const processInput = async (input) => {
    console.log('Processing:', input);
    return await talkToAvatar(input);
  };

  const talkToAvatar = async (text) => {
    const response = await fetch('https://ai-streaming-oymd.vercel.app/openai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log('ChatGPT response:', data.text);
      setDebug('Avatar response: ' + data.text);
      return data.text;
    } else {
      console.error('Failed to fetch response from ChatGPT');
      setDebug('Failed to get a response from AI');
    }
  };

  const sendToAvatar = async (session_id, text) => {
    const maxRetries = 5;
    let attempt = 0;
    let success = false;
    const retryDelay = 2000; // 2 seconds delay between retries

    while (attempt < maxRetries && !success) {
      try {
        const response = await fetch('https://api.heygen.com/v1/streaming.task', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'X-Api-Key': API_KEY,
          },
          body: JSON.stringify({ session_id, text: text }),
        });

        if (!response.ok) {
          const errorResponse = await response.json();
          console.error('Error Response:', errorResponse);
          throw new Error(`Error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Task sent successfully:', data);
        success = true;
        return data.data;
      } catch (error) {
        attempt++;
        console.error(`Attempt ${attempt} failed:`, error.message);
        setDebug(`Attempt ${attempt} failed: ${error.message}`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay)); // Wait before retrying
        }
      }
    }

    if (!success) {
      throw new Error('Failed to send task to avatar after multiple attempts');
    }
  };

  const sendEmptyPrompt = async () => {
    const response = await fetch('https://ai-streaming-oymd.vercel.app/openai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log('ChatGPT response to empty prompt:', data.text);
      setDebug('Avatar is ready.');
      return data.text;
    } else {
      console.error('Failed to fetch response from ChatGPT for empty prompt');
      setDebug('Failed to get a response from AI for empty prompt');
    }
  };

  const updateStatus = (message) => {
    setDebug(prevDebug => prevDebug + '\n' + message);
  };

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      recognition.current = new SpeechRecognition();
      recognition.current.continuous = false;
      recognition.current.interimResults = false;
      recognition.current.lang = 'en-US';

      recognition.current.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        document.getElementById('taskInput').value = transcript;
        console.log({ sessionInfo });
        if (sessionId) {
          await sendEmptyPrompt();
          const text = await processInput(transcript);
          console.log({ text });
          await sendToAvatar(sessionId, text);
        }
        recognition.current.stop();
      };

      recognition.current.onerror = (event) => {
        console.error('Speech recognition error:', event);
        updateStatus('Speech recognition error: ' + event.error);
        if (event.error === 'no-speech') {
          updateStatus('No speech detected. Please try again.');
        } else if (event.error === 'audio-capture') {
          updateStatus('No microphone detected. Please ensure your microphone is connected.');
        } else if (event.error === 'not-allowed') {
          updateStatus('Microphone access denied. Please allow microphone access.');
        }
      };

      recognition.current.onend = () => {
        if (!recognition.current.isRunning) {
          setTimeout(() => {
            recognition.current.start();
          }, 1000); // Restart recognition after a short delay
        }
      };

      if (!recognition.current.isRunning) {
        recognition.current.start();
        recognition.current.isRunning = true;
      }
    } else {
      updateStatus('Speech recognition not supported in this browser.');
    }

    return () => {
      if (recognition.current) {
        recognition.current.stop();
        recognition.current.isRunning = false;
      }
    };
  }, [sessionId]);

  useEffect(() => {
    if (recognition.current && !recognition.current.isRunning) {
      recognition.current.start();
      recognition.current.isRunning = true;
    }
  }, [debug]);

  return (
    <div className="main">
      <div className="actionRowsWrap">
        <div className="actionRow">
          <label>
            Avatars
            <select id="avatarID" value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
              {avatars.map(avatar => (
                <option key={avatar.avatar_id} value={avatar.avatar_id}>
                  {avatar.avatar_id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Voices
            <select id="voiceID" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {voices.map(voice => (
                <option key={voice.voice_id} value={voice.voice_id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="actionRow">
          <label>
            Message
            <input id="taskInput" type="text" placeholder="Enter your message" />
          </label>
        </div>
      </div>
      <p id="status">{debug}</p>
      <div className="videoSectionWrap">
        <div className="videoWrap">
          <video id="mediaElement" ref={videoRef} className="videoEle show" autoPlay playsInline></video>
          <canvas id="canvasElement" className="videoEle hide"></canvas>
        </div>
      </div>
    </div>
  );
};

export default App;
