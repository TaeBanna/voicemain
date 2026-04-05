// =====================================================
// CLASE: VOICE DETECTOR (Optimized)
// =====================================================

class VoiceDetector {
  constructor(stream, onVoiceChange) {
    this.stream = stream;
    this.onVoiceChange = onVoiceChange;
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.dataArray = null;
    this.isTalking = false;
    this.detectionInterval = null;

    // Configuración de umbrales
    this.threshold = -25;
    this.silenceThreshold = -30;
    this.silenceDelay = 500;
    this.lastSpeakTime = 0;

    this.init();
  }

  async init() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      // OPTIMIZED: ลด fftSize ลงจาก 2048 เหลือ 256 เพียงพอสำหรับการหาแค่ Volume และประหยัด CPU มหาศาล
      this.analyser.fftSize = 256; 
      this.analyser.smoothingTimeConstant = 0.8;

      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);

      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      this.startDetection();
      console.log("✓ Voice detector initialized");
    } catch (error) {
      console.error("❌ Voice detector init error:", error);
    }
  }

  getVolumeDb() {
    this.analyser.getByteTimeDomainData(this.dataArray);
    
    // OPTIMIZED: Cache ค่า length เพื่อลดการดึง Property ในลูป
    const len = this.dataArray.length;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const v = this.dataArray[i] - 128; // centrar
      sum += v * v;
    }

    const rms = Math.sqrt(sum / len);
    const db = 20 * Math.log10(rms / 128);

    return db;
  }

  startDetection() {
    // OPTIMIZED: ใส่ดีเลย์ 100ms (เช็ค 10 ครั้งต่อวินาที) เพียงพอแล้วสำหรับจับเสียงพูด ไม่ต้องรันรัวๆ จน CPU เต็ม
    this.detectionInterval = setInterval(() => {
      const volumeDb = this.getVolumeDb();
      const now = Date.now();

      if (volumeDb > this.threshold) {
        this.lastSpeakTime = now;

        if (!this.isTalking) {
          this.isTalking = true;
          this.notifyChange(true, volumeDb);
        }
      } else if (volumeDb < this.silenceThreshold && this.isTalking) {
        if (now - this.lastSpeakTime > this.silenceDelay) {
          this.isTalking = false;
          this.notifyChange(false, volumeDb);
        }
      }
      // แจ้งอัปเดตถ้ากำลังพูดอยู่ (สามารถลดได้ถ้าต้องการ แต่ 100ms ถือว่าโอเค)
      if(this.isTalking) this.notifyChange(this.isTalking, volumeDb);
    }, 100); 
  }

  notifyChange(isTalking, volumeDb) {
    if (this.onVoiceChange) {
      this.onVoiceChange(isTalking, volumeDb);
    }
  }

  setSensitivity(level) {
    switch (level) {
      case "low":
        this.threshold = -40;
        this.silenceThreshold = -48;
        break;
      case "medium":
        this.threshold = -34;
        this.silenceThreshold = -44;
        break;
      case "high":
        this.threshold = -30;
        this.silenceThreshold = -42;
        break;
      default:
        throw new Error(`Unknown sensitivity level: ${level}`);
    }
  }

  dispose() {
    if (this.detectionInterval) clearInterval(this.detectionInterval);
    if (this.microphone) this.microphone.disconnect();
    if (this.audioContext && this.audioContext.state !== "closed") this.audioContext.close();
    console.log("✓ Voice detector disposed");
  }
}

// =====================================================
// CLASE: AudioEffectsManager
// =====================================================
class AudioEffectsManager {
  constructor() {
    this.reverb = null;
    this.filter = null;
    this.chorus = null;
    this.dynamicNodes = [];
    this.currentEffect = "none";
    this.inputNode = null;
    this.processedStream = null;
    this.lastEffectChange = 0;
  }

  async init() {
    this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 });
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 1200 });
    this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0.25 });
    await this.reverb.generate();
    console.log("✓ Audio effects initialized");
  }

  createInputNode(micVolume = 1.0) {
    this.inputNode = new Tone.Gain(micVolume);
    return this.inputNode;
  }

  async applyEffect(effect, peerConnections) {
    if (!this.inputNode) return;

    const now = Date.now();
    if (this.currentEffect === effect && this.processedStream !== null) return;
    if (this.processedStream !== null && now - this.lastEffectChange < 1000) return;
    
    this.lastEffectChange = now;
    console.log(`🎨 Changing effect: ${this.currentEffect} → ${effect}`);

    const audioContext = Tone.context.rawContext || Tone.context._context;
    const dest = audioContext.createMediaStreamDestination();

    this.dynamicNodes.forEach((n) => {
      try {
        n.disconnect();
        if (n.dispose) n.dispose();
      } catch (e) {}
    });
    this.dynamicNodes = [];
    this.inputNode.disconnect();

    switch (effect) {
      case "underwater":
        this.filter.type = "lowpass";
        this.filter.frequency.value = 500;
        this.filter.Q.value = 1;
        this.reverb.decay = 2.8;
        this.reverb.wet.value = 0.5;
        this.inputNode.chain(this.filter, this.reverb, dest);
        break;
      case "cave":
        const caveDelay = new Tone.FeedbackDelay("0.15", 0.35);
        const caveReverb = new Tone.Reverb({ decay: 5, wet: 0.6 });
        const caveEQ = new Tone.EQ3(-2, 0, -1);
        this.dynamicNodes.push(caveDelay, caveReverb, caveEQ);
        await caveReverb.ready;
        this.inputNode.chain(caveEQ, caveReverb, caveDelay, dest);
        break;
      case "mountain":
        const mountainDelay = new Tone.FeedbackDelay("0.25", 0.25);
        const mountainReverb = new Tone.Reverb({ decay: 4, wet: 0.35 });
        const mountainEQ = new Tone.EQ3(-2, 0, -1);
        this.dynamicNodes.push(mountainDelay, mountainReverb, mountainEQ);
        await mountainReverb.ready;
        this.inputNode.chain(mountainEQ, mountainReverb, mountainDelay, dest);
        break;
      case "buried":
        const muffled = new Tone.Filter({ type: "lowpass", frequency: 250, Q: 2 });
        const secondFilter = new Tone.Filter({ type: "highpass", frequency: 150, Q: 1 });
        const lfo = new Tone.LFO("0.3Hz", 200, 400).start();
        lfo.connect(muffled.frequency);
        const buriedReverb = new Tone.Reverb({ decay: 4, wet: 0.7 });
        const gainNode = new Tone.Gain(0.8);
        this.dynamicNodes.push(muffled, secondFilter, lfo, buriedReverb, gainNode);
        await buriedReverb.ready;
        this.inputNode.chain(secondFilter, muffled, buriedReverb, gainNode, dest);
        break;
      default:
        const noiseGate = new Tone.Gate(-45, 0.15);
        const cleanFilter = new Tone.Filter({ type: "highpass", frequency: 80 });
        const lowpassFilter = new Tone.Filter({ type: "lowpass", frequency: 8000 });
        const compressor = new Tone.Compressor(-28, 2.5);
        this.dynamicNodes.push(noiseGate, cleanFilter, lowpassFilter, compressor);
        this.inputNode.chain(cleanFilter, noiseGate, lowpassFilter, compressor, dest);
        break;
    }

    this.processedStream = dest.stream;
    this.currentEffect = effect;

    if (this.processedStream && peerConnections && peerConnections.size > 0) {
      const newTrack = this.processedStream.getAudioTracks()[0];
      if (!newTrack) return;

      const updatePromises = [];
      peerConnections.forEach((peerData, gamertag) => {
        const pc = peerData.pc || peerData;
        const senders = pc.getSenders();
        const audioSender = senders.find((s) => s.track && s.track.kind === "audio");
        if (audioSender) {
          updatePromises.push(audioSender.replaceTrack(newTrack).catch(e => console.error(e)));
        }
      });
      await Promise.all(updatePromises);
    }
  }

  updateVolume(volume, peerConnections = null) {
    if (this.inputNode) {
      const oldVolume = this.inputNode.gain.value;
      const changed = Math.abs(oldVolume - volume) > 0.05;
      this.inputNode.gain.value = volume;
      if (changed) {
        console.log(`🎚️ Volume: ${(oldVolume * 100).toFixed(0)}% → ${(volume * 100).toFixed(0)}%`);
      }
    }
  }

  getProcessedStream() { return this.processedStream; }
  getCurrentEffect() { return this.currentEffect; }
}

// =====================================================
// CLASE: PushToTalkManager
// =====================================================
class PushToTalkManager {
  constructor(micManager, webrtcManager) {
    this.micManager = micManager;
    this.webrtcManager = webrtcManager;
    this.enabled = false;
    this.key = "KeyV";
    this.keyDisplay = "V";
    this.isKeyPressed = false;
    this.isTalking = false;
    this.onTalkingChange = null;
  }

  setWebRTCManager(webrtcManager) { this.webrtcManager = webrtcManager; }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.isTalking = false;
      this.isKeyPressed = false;
      this.muteAllSenders();
      this.notifyTalkingChange();
    } else {
      this.isTalking = true;
      this.unmuteAllSenders();
      this.notifyTalkingChange();
    }
  }

  muteAllSenders() {
    if (!this.webrtcManager || !this.webrtcManager.peerConnections) return;
    this.webrtcManager.peerConnections.forEach((pc) => {
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") sender.track.enabled = false;
      });
    });
  }

  unmuteAllSenders() {
    if (!this.webrtcManager || !this.webrtcManager.peerConnections) return;
    this.webrtcManager.peerConnections.forEach((pc) => {
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") sender.track.enabled = true;
      });
    });
  }

  setKey(key, display) {
    this.key = key;
    this.keyDisplay = display;
  }

  handleKeyDown(event) {
    if (!this.enabled) return;
    if (event.code === this.key && !this.isKeyPressed) {
      this.isKeyPressed = true;
      this.isTalking = true;
      this.unmuteAllSenders();
      this.notifyTalkingChange();
      this.showTalkingIndicator();
    }
  }

  handleKeyUp(event) {
    if (!this.enabled) return;
    if (event.code === this.key && this.isKeyPressed) {
      this.isKeyPressed = false;
      this.isTalking = false;
      this.muteAllSenders();
      this.notifyTalkingChange();
      this.hideTalkingIndicator();
    }
  }

  showTalkingIndicator() {
    let indicator = document.getElementById("pttActiveIndicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "pttActiveIndicator";
      indicator.className = "ptt-active-indicator";
      indicator.textContent = `🎤 Talking (${this.keyDisplay})`;
      document.body.appendChild(indicator);
    }
  }

  hideTalkingIndicator() {
    const indicator = document.getElementById("pttActiveIndicator");
    if (indicator) indicator.remove();
  }

  setOnTalkingChange(callback) { this.onTalkingChange = callback; }
  notifyTalkingChange() { if (this.onTalkingChange) this.onTalkingChange(this.isTalking); }
  isSpeaking() { return this.isTalking; }
  isEnabled() { return this.enabled; }
}

// =====================================================
// CLASE: MicrophoneManager
// =====================================================
class MicrophoneManager {
  constructor(audioEffects) {
    this.mediaStream = null;
    this.mediaStreamSource = null;
    this.audioEffects = audioEffects;
    this.isMuted = false;
  }

  async start(micVolume = 1.0) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Your browser doesn't support audio capture.");
    }
    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    };
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioContext = Tone.context.rawContext || Tone.context._context;
      this.mediaStreamSource = audioContext.createMediaStreamSource(this.mediaStream);
      const inputNode = this.audioEffects.createInputNode(micVolume);
      this.mediaStreamSource.connect(inputNode.input);
      await this.audioEffects.applyEffect("none", null);
    } catch (error) {
      throw new Error("Error accessing microphone: " + error.message);
    }
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => (track.enabled = !this.isMuted));
    }
    return this.isMuted;
  }

  setEnabled(enabled) {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => (track.enabled = enabled));
    }
  }

  getStream() { return this.mediaStream; }
  isMicMuted() { return this.isMuted; }

  async changeMicrophone(deviceId) {
    this.stop();
    try {
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        },
      };
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioContext = Tone.context.rawContext || Tone.context._context;
      this.mediaStreamSource = audioContext.createMediaStreamSource(this.mediaStream);
      const inputNode = this.audioEffects.createInputNode(1.0);
      this.mediaStreamSource.connect(inputNode.input);
      await this.audioEffects.applyEffect("none", null);
      return true;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
}

// =====================================================
// CLASE: Participant
// =====================================================
class Participant {
  constructor(gamertag, isSelf = false) {
    this.gamertag = gamertag;
    this.isSelf = isSelf;
    this.distance = 0;
    this.volume = 1;
    this.gainNode = null;
    this.audioElement = null;
    this.source = null;
    this.customVolume = 1;
    this.skinUrl = this.generateSkinUrl(gamertag);
  }

  generateSkinUrl(gamertag) {
    return `https://mc-api.io/render/face/${encodeURIComponent(gamertag)}/bedrock`;
  }

  setAudioNodes(gainNode, audioElement, source) {
    this.gainNode = gainNode;
    this.audioElement = audioElement;
    this.source = source;
  }

  setCustomVolume(volume) { this.customVolume = volume; }

  updateVolume(newVolume) {
    const outputGain = window._enviroOutputVolume !== undefined ? window._enviroOutputVolume : 1.0;
    const finalVolume = newVolume * this.customVolume;
    this.volume = finalVolume;

    if (this.gainNode) {
      this.gainNode.gain.value = finalVolume * outputGain;
      if (this.audioElement) this.audioElement.volume = 0;
    } else if (this.audioElement) {
      this.audioElement.volume = Math.min(1, Math.max(0, finalVolume * outputGain));
    }
  }

  updateDistance(distance) { this.distance = distance; }

  cleanup() {
    if (this.source) { try { this.source.disconnect(); } catch (e) {} }
    if (this.gainNode) { try { this.gainNode.disconnect(); } catch (e) {} }
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.srcObject = null;
        this.audioElement.remove();
      } catch (e) {}
    }
  }

  getDisplayInfo() {
    return {
      gamertag: this.gamertag,
      isSelf: this.isSelf,
      distance: Math.round(this.distance),
      volume: this.volume,
      skinUrl: this.skinUrl,
    };
  }
}

// =====================================================
// CLASE: ParticipantsManager
// =====================================================
class ParticipantsManager {
  constructor() {
    this.participants = new Map();
    this.pendingNodes = new Map();
  }

  add(gamertag, isSelf = false) {
    if (this.participants.has(gamertag)) return;
    const participant = new Participant(gamertag, isSelf);
    const pendingData = this.pendingNodes.get(gamertag);
    if (pendingData) {
      participant.setAudioNodes(pendingData.gainNode, pendingData.audioElement, pendingData.source);
      if (pendingData.gainNode) pendingData.gainNode.gain.value = 1;
      this.pendingNodes.delete(gamertag);
    }
    this.participants.set(gamertag, participant);
  }

  remove(gamertag) {
    const participant = this.participants.get(gamertag);
    if (participant) {
      participant.cleanup();
      this.participants.delete(gamertag);
    }
  }

  get(gamertag) { return this.participants.get(gamertag); }
  has(gamertag) { return this.participants.has(gamertag); }
  getAll() { return Array.from(this.participants.values()); }
  
  clear() {
    this.participants.forEach((p) => p.cleanup());
    this.participants.clear();
    this.pendingNodes.clear();
  }

  addPendingNode(gamertag, nodeData) { this.pendingNodes.set(gamertag, nodeData); }
  forEach(callback) { this.participants.forEach(callback); }
}

// =====================================================
// CLASE: WebRTCManager
// =====================================================
class WebRTCManager {
  constructor(participantsManager, audioEffects, minecraft, onTrackReceived) {
    this.peerConnections = new Map();
    this.participantsManager = participantsManager;
    this.audioEffects = audioEffects;
    this.minecraft = minecraft;
    this.onTrackReceived = onTrackReceived;
    this.ws = null;
    this.currentGamertag = "";
  }

  setWebSocket(ws) { this.ws = ws; }
  setGamertag(gamertag) { this.currentGamertag = gamertag; }

  async createPeerConnection(remoteGamertag) {
    if (this.peerConnections.has(remoteGamertag)) {
      return this.peerConnections.get(remoteGamertag);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
      ],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate && this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: "ice-candidate", candidate: e.candidate, from: this.currentGamertag, to: remoteGamertag }));
      }
    };

    pc._isInitialConnection = true;
    pc._reconnectAttempts = 0;

    pc.onnegotiationneeded = async () => {
      if (pc._isInitialConnection) return;
      try {
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: "offer", offer: offer, from: this.currentGamertag, to: remoteGamertag }));
        }
      } catch (e) { console.error(e); }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (!remoteStream) return;

      const oldEl = document.getElementById(`audio-${remoteGamertag}`);
      if (oldEl) {
        oldEl.pause();
        oldEl.srcObject = null;
        oldEl.remove();
      }

      const audioElement = document.createElement("audio");
      audioElement.srcObject = remoteStream;
      audioElement.autoplay = true;
      audioElement.playsInline = true;
      audioElement.volume = 1.0;
      audioElement.id = `audio-${remoteGamertag}`;
      audioElement.style.display = "none";
      document.body.appendChild(audioElement);

      const playAudio = () => {
        const playPromise = audioElement.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            const resume = () => {
              audioElement.play().catch(() => {});
              document.removeEventListener("click", resume);
              document.removeEventListener("touchend", resume);
            };
            document.addEventListener("click", resume);
            document.addEventListener("touchend", resume);
          });
        }
      };
      playAudio();

      let remoteGain = null;
      let remoteSource = null;
      try {
        const remoteAudioCtx = Tone.context.rawContext || Tone.context._context;
        if (remoteAudioCtx.state === "running") {
          remoteSource = remoteAudioCtx.createMediaStreamSource(remoteStream);
          remoteGain = remoteAudioCtx.createGain();
          remoteGain.gain.value = 1.0;
          remoteSource.connect(remoteGain);
          remoteGain.connect(remoteAudioCtx.destination);
          audioElement.volume = 0;
        }

        remoteAudioCtx.onstatechange = () => {
          if (remoteAudioCtx.state === "running" && !remoteGain) {
            try {
              remoteSource = remoteAudioCtx.createMediaStreamSource(remoteStream);
              remoteGain = remoteAudioCtx.createGain();
              remoteGain.gain.value = 1.0;
              remoteSource.connect(remoteGain);
              remoteGain.connect(remoteAudioCtx.destination);
              audioElement.volume = 0;
              const p = this.participantsManager.get(remoteGamertag);
              if (p) p.setAudioNodes(remoteGain, audioElement, remoteSource);
            } catch (e) {}
          }
        };
      } catch (e) {}

      const participant = this.participantsManager.get(remoteGamertag);
      if (participant) {
        participant.setAudioNodes(remoteGain, audioElement, remoteSource);
        participant.updateVolume(1);
        setTimeout(() => { if (this.minecraft && this.minecraft.isInGame()) this.minecraft.processUpdate(); }, 500);
      } else {
        this.participantsManager.addPendingNode(remoteGamertag, { gainNode: remoteGain, audioElement, source: remoteSource });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.attemptReconnect(remoteGamertag);
      if (pc.connectionState === "connected") {
        pc._isInitialConnection = false;
        pc._reconnectAttempts = 0;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") pc.restartIce();
    };

    const processedStream = this.audioEffects.getProcessedStream();
    if (processedStream) {
      processedStream.getTracks().forEach((track) => pc.addTrack(track, processedStream));
    }

    this.peerConnections.set(remoteGamertag, pc);
    return pc;
  }

  async attemptReconnect(remoteGamertag) {
    const oldPc = this.peerConnections.get(remoteGamertag);
    const attempts = (oldPc?._reconnectAttempts || 0) + 1;
    if (attempts > 3) return;

    this.closePeerConnection(remoteGamertag);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      const pc = await this.createPeerConnection(remoteGamertag);
      pc._reconnectAttempts = attempts;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: "offer", offer: offer, from: this.currentGamertag, to: remoteGamertag }));
      }
    } catch (e) {}
  }

  async reconnectAllPeers() {
    const gamertags = Array.from(this.peerConnections.keys());
    if (gamertags.length === 0) return;

    this.closeAllConnections();
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const gamertag of gamertags) {
      try {
        const pc = await this.createPeerConnection(gamertag);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: "offer", offer: offer, from: this.currentGamertag, to: gamertag }));
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (e) {}
    }
  }

  closePeerConnection(gamertag) {
    const pc = this.peerConnections.get(gamertag);
    if (pc) {
      pc.close();
      this.peerConnections.delete(gamertag);
    }
  }

  closeAllConnections() {
    this.peerConnections.forEach((pc, gamertag) => this.closePeerConnection(gamertag));
  }

  getPeerConnection(gamertag) { return this.peerConnections.get(gamertag); }
  forEach(callback) { this.peerConnections.forEach(callback); }

  async updateMicrophoneStream(newStream) {
    if (!newStream) return;
    const audioTrack = newStream.getAudioTracks()[0];
    if (!audioTrack) return;

    this.peerConnections.forEach((pc, gamertag) => {
      const senders = pc.getSenders();
      const audioSender = senders.find((sender) => sender.track?.kind === "audio");
      if (audioSender) audioSender.replaceTrack(audioTrack).catch(() => {});
    });
  }
}

// =====================================================
// CLASE: DistanceCalculator
// =====================================================
class DistanceCalculator {
  constructor(maxDistance = 20) { this.maxDistance = maxDistance; }
  calculate(pos1, pos2) {
    const dx = pos1.x - pos2.x, dy = pos1.y - pos2.y, dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  volumeFromDistance(distance) {
    if (distance > this.maxDistance) return 0;
    return Math.pow(1 - distance / this.maxDistance, 2);
  }
}

// =====================================================
// CLASE: MinecraftIntegration
// =====================================================
class MinecraftIntegration {
  constructor(participantsManager, audioEffects, micManager, distanceCalculator, webrtcManager) {
    this.participantsManager = participantsManager;
    this.audioEffects = audioEffects;
    this.micManager = micManager;
    this.distanceCalculator = distanceCalculator;
    this.webrtcManager = webrtcManager;
    this.minecraftData = null;
    this.currentGamertag = "";
    this.isPlayerInGame = false;
    this.remoteMuted = false;
    this.remoteDeafened = false;
    this.onMuteChange = null;
    this.onDeafenChange = null;
    this.playerVolumes = new Map();
    this.pushToTalkManager = null;
    this.lastMicVolume = null;
    this.lastEffectChange = 0;
    this.effectThrottleMs = 1000;
  }

  setPushToTalkManager(pttManager) { this.pushToTalkManager = pttManager; }
  setGamertag(gamertag) { this.currentGamertag = gamertag; }
  setOnMuteChange(callback) { this.onMuteChange = callback; }
  setOnDeafenChange(callback) { this.onDeafenChange = callback; }

  updateData(data) {
    this.minecraftData = data;
    this.processUpdate();
  }

  processUpdate() {
    if (!this.minecraftData || !this.currentGamertag) return;

    const playersList = Array.isArray(this.minecraftData) ? this.minecraftData : this.minecraftData.players;

    if (this.minecraftData.config && this.minecraftData.config.maxDistance) {
      this.distanceCalculator.maxDistance = this.minecraftData.config.maxDistance;
    }

    const myPlayer = playersList.find((p) => p.name.trim().toLowerCase() === this.currentGamertag.trim().toLowerCase());
    const wasInGame = this.isPlayerInGame;
    this.isPlayerInGame = !!myPlayer;

    if (!myPlayer) return;

    const remoteMutedNow = myPlayer.data.isMuted || false;
    if (remoteMutedNow !== this.remoteMuted) {
      this.remoteMuted = remoteMutedNow;
      if (this.onMuteChange) this.onMuteChange(this.remoteMuted);
    }

    const remoteDeafenedNow = myPlayer.data.isDeafened || false;
    if (remoteDeafenedNow !== this.remoteDeafened) {
      this.remoteDeafened = remoteDeafenedNow;
      if (this.onDeafenChange) this.onDeafenChange(this.remoteDeafened);
    }

    if (myPlayer.data.micVolume !== undefined && myPlayer.data.micVolume !== this.lastMicVolume) {
      this.lastMicVolume = myPlayer.data.micVolume;
      this.audioEffects.updateVolume(this.lastMicVolume, this.webrtcManager?.peerConnections);
    }

    if (myPlayer.data.customVolumes) {
      this.participantsManager.forEach((participant, gamertag) => {
        if (participant.isSelf) return;
        const customVolume = myPlayer.data.customVolumes[gamertag];
        if (customVolume !== undefined) participant.setCustomVolume(customVolume);
      });
    }

    const shouldBeMuted = this.micManager.isMicMuted() || this.remoteMuted;
    if (!this.pushToTalkManager || !this.pushToTalkManager.isEnabled()) {
      this.micManager.setEnabled(!shouldBeMuted);
    }

    this.applyEnvironmentalEffects(myPlayer);
    this.updateParticipantVolumes(myPlayer, playersList);
  }

  applyEnvironmentalEffects(myPlayer) {
    const now = Date.now();
    if (now - this.lastEffectChange < this.effectThrottleMs) return;
    this.lastEffectChange = now;
    
    let targetEffect = "none";
    if (myPlayer.data.isUnderWater) targetEffect = "underwater";
    else if (myPlayer.data.isInCave) targetEffect = "cave";
    else if (myPlayer.data.isInMountain) targetEffect = "mountain";
    else if (myPlayer.data.isBuried) targetEffect = "buried";

    if (targetEffect !== this.audioEffects.getCurrentEffect()) {
      this.audioEffects.applyEffect(targetEffect, this.webrtcManager?.peerConnections);
    }
  }

  updateParticipantVolumes(myPlayer, playersList) {
    this.participantsManager.forEach((participant, gamertag) => {
      if (participant.isSelf) return;

      const otherPlayer = playersList.find((pl) => pl.name.trim().toLowerCase() === gamertag.trim().toLowerCase());

      if (otherPlayer) {
        if (otherPlayer.data.isMuted || this.remoteDeafened) {
          participant.updateVolume(0);
          return;
        }
        const distance = this.distanceCalculator.calculate(myPlayer.location, otherPlayer.location);
        const volume = this.distanceCalculator.volumeFromDistance(distance);
        participant.updateDistance(distance);
        participant.updateVolume(volume);
      } else {
        participant.updateVolume(0);
      }
    });
  }

  isInGame() { return this.isPlayerInGame; }
  isRemoteMuted() { return this.remoteMuted; }
  isRemoteDeafened() { return this.remoteDeafened; }
}

// =====================================================
// CLASE: UIManager (Optimized)
// =====================================================
class UIManager {
  constructor() {
    this.elements = {
      gamertagInput: document.getElementById("gamertagInput"),
      gamertagStatus: document.getElementById("gamertagStatus"),
      roomUrlInput: document.getElementById("roomUrlInput"),
      connectBtn: document.getElementById("connectToRoomBtn"),
      roomInfo: document.getElementById("roomInfo"),
      callControls: document.getElementById("callControls"),
      exitBtn: document.getElementById("exitBtn"),
      participantsList: document.getElementById("participantsList"),
      setupSection: document.getElementById("setupSection"),
      gameStatus: document.getElementById("gameStatus"),
      minecraftConnectContainer: document.createElement("div"),
      pttContainer: document.getElementById("pttContainer"),
      pttToggle: document.getElementById("pttToggle"),
      pttKeySelector: document.getElementById("pttKeySelector"),
      pttKeyInput: document.getElementById("pttKeyInput"),
      pttKeyDisplay: document.getElementById("pttKeyDisplay"),
      micSelector: document.getElementById("micSelector"),
    };

    this.elements.minecraftConnectContainer.id = "minecraftConnectContainer";
    if(this.elements.gameStatus) {
      this.elements.gameStatus.parentNode.insertBefore(
        this.elements.minecraftConnectContainer,
        this.elements.gameStatus.nextSibling
      );
    }

    this.onOutputVolumeChange = null;
    window._enviroOutputVolume = 1.0;
    const _ovSlider = document.getElementById("outputVolumeSlider");
    const _ovLabel  = document.getElementById("outputVolumeLabel");
    if (_ovSlider) {
      _ovSlider.addEventListener("input", (e) => {
        const pct = parseInt(e.target.value, 10);
        window._enviroOutputVolume = pct / 100;
        if (_ovLabel) _ovLabel.textContent = pct + "%";
        if (this.onOutputVolumeChange) this.onOutputVolumeChange(window._enviroOutputVolume);
      });
    }

    this.isPC = this.detectPC();
    if (this.isPC && this.elements.pttContainer) {
      this.elements.pttContainer.style.display = "block";
    }
  }

  setOnOutputVolumeChange(cb) { this.onOutputVolumeChange = cb; }

  detectPC() {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
    return !isTouchDevice || !isMobile;
  }

  updateGamertagStatus(gamertag) {
    this.elements.gamertagStatus.textContent = gamertag ? `✓ Gamertag: ${gamertag}` : "⚠️ Enter your gamertag to continue";
    this.elements.gamertagStatus.style.color = gamertag ? "#22c55e" : "#ef4444";
  }

  updateRoomInfo(message) { this.elements.roomInfo.textContent = message; }
  showCallControls(show) {
    this.elements.setupSection.style.display = show ? "none" : "block";
    this.elements.callControls.style.display = show ? "flex" : "none";
  }

  updateGameStatus(isInGame) {
    if (!this.elements.gameStatus) return;
    if (isInGame) {
      this.elements.gameStatus.innerHTML = '<span style="color:#22c55e;">✓ Connected to Minecraft server</span>';
      this.clearMinecraftConnectUI();
    } else {
      this.elements.gameStatus.innerHTML = '<span style="color:#ef4444;">⚠️ Not connected to Minecraft server</span>';
      this.showMinecraftConnectUI();
    }
  }

  showMinecraftConnectUI() {
    const container = this.elements.minecraftConnectContainer;
    if (!document.getElementById("mcInfoText")) {
      const infoText = document.createElement("p");
      infoText.id = "mcInfoText";
      infoText.textContent = "Haven't joined the server yet? Enter the IP and port here and we'll connect you!";
      infoText.style.marginBottom = "8px";
      container.appendChild(infoText);
    }

    let input = document.getElementById("mcServerInput");
    if (!input) {
      input = document.createElement("input");
      input.type = "text";
      input.id = "mcServerInput";
      input.placeholder = "hive.net:19132";
      input.className = "input-field";
      input.style.marginRight = "10px";
      container.appendChild(input);

      input.addEventListener("input", () => {
        const existingBtn = document.getElementById("mcConnectBtn");
        if (input.value.trim() && !existingBtn) {
          const btn = document.createElement("button");
          btn.id = "mcConnectBtn";
          btn.className = "primary-btn";
          btn.textContent = "Connect to MC Server";
          btn.addEventListener("click", () => {
            const [ip, port] = input.value.split(":");
            if (!ip || !port) return alert("⚠️ Invalid format. Use IP:PORT");
            window.location.href = `minecraft://connect?serverUrl=${ip}&serverPort=${port}`;
          });
          container.appendChild(btn);
        } else if (!input.value.trim() && existingBtn) {
          existingBtn.remove();
        }
      });
    }
  }

  clearMinecraftConnectUI() { this.elements.minecraftConnectContainer.innerHTML = ""; }

  // OPTIMIZED: ฟังก์ชัน updateParticipantsList แทนที่จะลบทิ้ง (innerHTML="") แล้วสร้างใหม่ตลอด
  // ให้เช็คว่ามี Element อยู่ไหม ถ้ามีแค่เปลี่ยนค่าข้างใน (DOM Diffing แบบง่ายๆ)
  updateParticipantsList(participants) {
    const container = this.elements.participantsList;
    const currentTags = new Set(participants.map(p => p.gamertag));

    // ลบคนที่ออกไปแล้ว
    Array.from(container.children).forEach(child => {
      if (!currentTags.has(child.dataset.gamertag)) {
        child.remove();
      }
    });

    // อัปเดตข้อมูลหรือสร้างใหม่เฉพาะเมื่อไม่มี
    participants.forEach((p) => {
      const info = p.getDisplayInfo();
      const distanceText = info.isSelf ? "" : ` - ${info.distance}m`;
      const volumeIcon = info.volume === 0 ? "🔇" : info.volume < 0.3 ? "🔉" : "🔊";

      let el = container.querySelector(`[data-gamertag="${info.gamertag}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "participant participant-card";
        el.dataset.gamertag = info.gamertag;
        container.appendChild(el);
      }

      // โครงสร้าง HTML ด้านในของการ์ด
      const newHtml = `
        <div class="p-avatar">
          <img src="${info.skinUrl}" alt="${info.gamertag}" class="participant-skin" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <div class="p-avatar-fallback participant-icon" style="display:none;">👤</div>
        </div>
        <div class="p-info">
          <div class="p-name participant-name">
            ${info.gamertag} ${info.isSelf ? '<span class="you-badge">You</span>' : ''}
          </div>
          <div class="p-dist">${distanceText}</div>
        </div>
        ${!info.isSelf ? `<div class="p-vol volume-indicator">${volumeIcon}</div>` : ''}
      `;

      // อัปเดต DOM เฉพาะเมื่อข้อมูลด้านในไม่เหมือนเดิมจริงๆ เท่านั้น!
      if (el.innerHTML !== newHtml) {
        el.innerHTML = newHtml;
      }
    });
  }

  getGamertag() { return this.elements.gamertagInput.value.trim(); }
  getRoomUrl() { return this.elements.roomUrlInput.value.trim(); }

  async populateMicrophoneSelector() {
    if (!this.elements.micSelector) return;
    try {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach((track) => track.stop());
      } catch (permError) {}

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");

      this.elements.micSelector.innerHTML = "";
      if (audioInputs.length === 0) {
        this.elements.micSelector.innerHTML = '<option value="">No microphones found</option>';
        this.elements.micSelector.disabled = true;
        return;
      }

      audioInputs.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        let label = device.label || `Microphone ${index + 1}`;
        if (label.length > 50) label = label.substring(0, 47) + "...";
        option.textContent = label;
        if (device.deviceId === "default" || index === 0) option.selected = true;
        this.elements.micSelector.appendChild(option);
      });
      this.elements.micSelector.disabled = false;
    } catch (error) {
      this.elements.micSelector.innerHTML = '<option value="">Error loading microphones</option>';
      this.elements.micSelector.disabled = true;
    }
  }

  isPCDevice() { return this.isPC; }
}

// =====================================================
// CLASE PRINCIPAL: VoiceChatApp
// =====================================================
class VoiceChatApp {
  constructor() {
    this.ui = new UIManager();
    this.audioEffects = new AudioEffectsManager();
    this.micManager = new MicrophoneManager(this.audioEffects);
    this.participantsManager = new ParticipantsManager();
    this.distanceCalculator = new DistanceCalculator(20);
    this.voiceDetector = null;
    this.webrtc = new WebRTCManager(this.participantsManager, this.audioEffects, null, (p) => this.onTrackReceived(p));
    this.pushToTalk = new PushToTalkManager(this.micManager, this.webrtc);
    this.minecraft = new MinecraftIntegration(this.participantsManager, this.audioEffects, this.micManager, this.distanceCalculator, this.webrtc);

    this.webrtc.minecraft = this.minecraft;
    this.minecraft.setPushToTalkManager(this.pushToTalk);

    this.ui.setOnOutputVolumeChange(() => {
      this.participantsManager.forEach((p) => {
        if (!p.isSelf) p.updateVolume(p.volume / Math.max(0.001, p.customVolume));
      });
    });

    this.minecraft.setOnMuteChange(() => this.updateUI());
    this.minecraft.setOnDeafenChange(() => this.updateUI());

    this.pushToTalk.setOnTalkingChange((isTalking) => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: "ptt-status", gamertag: this.currentGamertag, isTalking: isTalking, isMuted: !isTalking }));
      }
    });

    this.ws = null;
    this.currentGamertag = "";
    this.heartbeatInterval = null;
    
    // OPTIMIZED: ตัวแปรสำหรับการหน่วง UI ให้วาดแค่ตอนจำเป็น
    this.uiUpdatePending = false;
  }

  async init() {
    this.checkHTTPS();
    await this.audioEffects.init();
    this.setupEventListeners();
    this.setupPushToTalk();
  }

  checkHTTPS() {
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "";
    const isHTTPS = window.location.protocol === "https:";
    if (!isHTTPS && !isLocalhost) {
      const warning = document.createElement("div");
      warning.className = "https-warning";
      warning.innerHTML = "⚠️ Warning: Not using HTTPS. Microphone may not work on mobile devices.";
      document.body.prepend(warning);
    }
  }

  setupEventListeners() {
    this.ui.elements.gamertagInput.addEventListener("input", (e) => {
      this.currentGamertag = e.target.value.trim();
      this.ui.updateGamertagStatus(this.currentGamertag);
    });
    this.ui.elements.connectBtn.addEventListener("click", async () => {
      if (Tone.context.state !== "running") await Tone.start();
      this.connectToRoom();
    });
    this.ui.elements.exitBtn.addEventListener("click", () => this.exitCall());
  }

  setupPushToTalk() {
    if (!this.ui.isPCDevice()) return;

    let isListeningForKey = false;
    let keyListener = null;

    if(this.ui.elements.pttToggle) {
      this.ui.elements.pttToggle.addEventListener("change", (e) => {
        const enabled = e.target.checked;
        this.pushToTalk.setEnabled(enabled);
        if (this.ui.elements.pttKeySelector) {
          this.ui.elements.pttKeySelector.style.display = enabled ? "flex" : "none";
        }
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: "ptt-status", gamertag: this.currentGamertag, isTalking: !enabled, isMuted: enabled }));
        }
      });
    }

    if(this.ui.elements.pttKeyInput) {
      this.ui.elements.pttKeyInput.addEventListener("click", () => {
        if (isListeningForKey) return;
        isListeningForKey = true;
        this.ui.elements.pttKeyInput.classList.add("listening");
        this.ui.elements.pttKeyInput.textContent = "Press any key...";
        this.ui.elements.pttKeyDisplay.textContent = "Listening...";

        if (keyListener) document.removeEventListener("keydown", keyListener);
        keyListener = (e) => {
          e.preventDefault(); e.stopPropagation();
          const key = e.code;
          const display = this.getKeyDisplay(e);
          this.pushToTalk.setKey(key, display);
          this.ui.elements.pttKeyInput.textContent = display;
          this.ui.elements.pttKeyDisplay.textContent = `Press and hold ${display} to talk`;
          this.ui.elements.pttKeyInput.classList.remove("listening");
          document.removeEventListener("keydown", keyListener);
          keyListener = null;
          isListeningForKey = false;
        };
        document.addEventListener("keydown", keyListener);
      });
    }

    document.addEventListener("keydown", (e) => { if (!isListeningForKey) this.pushToTalk.handleKeyDown(e); });
    document.addEventListener("keyup", (e) => { if (!isListeningForKey) this.pushToTalk.handleKeyUp(e); });
  }

  getKeyDisplay(event) {
    if (event.key.length === 1) return event.key.toUpperCase();
    const keyMap = { Space: "SPACE", ShiftLeft: "LEFT SHIFT", ShiftRight: "RIGHT SHIFT", ControlLeft: "LEFT CTRL", ControlRight: "RIGHT CTRL", AltLeft: "LEFT ALT", AltRight: "RIGHT ALT", Tab: "TAB", CapsLock: "CAPS LOCK", Enter: "ENTER", Backspace: "BACKSPACE" };
    return keyMap[event.code] || event.code;
  }

  async connectToRoom() {
    const url = this.ui.getRoomUrl();
    if (!this.currentGamertag) return alert("⚠️ Enter your gamertag to continue");
    if (!url) return alert("⚠️ Enter a valid room URL");

    try {
      this.ui.updateRoomInfo("Connecting to server...");
      this.webrtc.closeAllConnections();
      if (this.ws) this.ws.close();

      try {
        await this.micManager.start(1.0);
      } catch (micError) {
        alert("❌ Could not access microphone. " + micError.message);
        this.ui.updateRoomInfo("❌ Microphone error");
        return;
      }

      const micStream = this.micManager.getStream();
      if (micStream) {
        this.voiceDetector = new VoiceDetector(micStream, (isTalking, volumeDb) => {
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ type: "voice-detection", gamertag: this.currentGamertag, isTalking: isTalking, volume: volumeDb }));
          }
        });
        this.voiceDetector.setSensitivity("high");
      }

      this.webrtc.setGamertag(this.currentGamertag);
      this.minecraft.setGamertag(this.currentGamertag);
      this.ws = new WebSocket(url.replace("http", "ws"));
      this.webrtc.setWebSocket(this.ws);
      this.ws.onopen = () => this.onWebSocketOpen();
      this.ws.onmessage = (msg) => this.onWebSocketMessage(msg);
      this.ws.onerror = () => this.onWebSocketError();
      this.ws.onclose = () => this.exitCall();
    } catch (e) {
      alert("Error connecting: " + e.message);
    }
  }

  async onWebSocketOpen() {
    this.ui.updateRoomInfo("✅ Connected to voice chat");
    this.ws.send(JSON.stringify({ type: "join", gamertag: this.currentGamertag }));
    this.ws.send(JSON.stringify({ type: "request-participants" }));

    const isPTTEnabled = this.pushToTalk.isEnabled();
    const isTalking = isPTTEnabled ? this.pushToTalk.isSpeaking() : true;
    this.ws.send(JSON.stringify({ type: "ptt-status", gamertag: this.currentGamertag, isTalking: isTalking, isMuted: !isTalking }));

    this.ui.showCallControls(true);
    this.participantsManager.add(this.currentGamertag, true);
    this.updateUI();

    await this.ui.populateMicrophoneSelector();

    if (this.ui.elements.micSelector) {
      this.ui.elements.micSelector.addEventListener("change", async (e) => {
        const deviceId = e.target.value;
        if (!deviceId) return;
        try {
          await this.micManager.changeMicrophone(deviceId);
          if (this.voiceDetector) this.voiceDetector.dispose();
          const micStream = this.micManager.getStream();
          if (micStream) {
            this.voiceDetector = new VoiceDetector(micStream, (isTalking, volumeDb) => {
              if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: "voice-detection", gamertag: this.currentGamertag, isTalking: isTalking, volume: volumeDb }));
            });
            this.voiceDetector.setSensitivity("high");
          }
          await this.webrtc.updateMicrophoneStream(micStream);
        } catch (error) { alert("Error changing microphone: " + error.message); }
      });
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: "heartbeat", gamertag: this.currentGamertag }));
    }, 15000);
  }

  async onWebSocketMessage(msg) {
    const data = JSON.parse(msg.data);
    if (data.type === "heartbeat") return;

    if (data.type === "minecraft-update") {
      this.minecraft.updateData(data.data);
      if (data.muteStates) {
        const myState = data.muteStates.find((s) => s.gamertag === this.currentGamertag);
        if (myState) {
          if (myState.isMuted !== this.minecraft.remoteMuted) {
            this.minecraft.remoteMuted = myState.isMuted;
            if (!this.pushToTalk || !this.pushToTalk.isEnabled()) this.micManager.setEnabled(!myState.isMuted);
          }
          if (myState.micVolume !== undefined) {
            const currentVolume = this.audioEffects.inputNode?.gain.value || 1;
            if (Math.abs(currentVolume - myState.micVolume) > 0.01) {
              this.audioEffects.updateVolume(myState.micVolume, this.webrtc?.peerConnections);
            }
          }
          if (myState.isDeafened !== this.minecraft.remoteDeafened) {
            this.minecraft.remoteDeafened = myState.isDeafened;
            if (myState.isDeafened) {
              this.minecraft.remoteMuted = true;
              if (!this.pushToTalk || !this.pushToTalk.isEnabled()) this.micManager.setEnabled(false);
            }
          }
        }
      }
      this.updateUI();
      return;
    }
    await this.handleSignaling(data);
  }

  async handleSignaling(data) {
    try {
      if (data.type === "join" && data.gamertag !== this.currentGamertag) {
        this.participantsManager.add(data.gamertag, false);
        if (!this.webrtc.getPeerConnection(data.gamertag)) {
          const pc = await this.webrtc.createPeerConnection(data.gamertag);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.ws.send(JSON.stringify({ type: "offer", offer: offer, from: this.currentGamertag, to: data.gamertag }));
        }
        this.updateUI();
      } else if (data.type === "leave") {
        this.participantsManager.remove(data.gamertag);
        this.webrtc.closePeerConnection(data.gamertag);
        await this.webrtc.reconnectAllPeers();
        this.updateUI();
      } else if (data.type === "offer" && data.to === this.currentGamertag) {
        this.participantsManager.add(data.from, false);
        let pc = this.webrtc.getPeerConnection(data.from);
        if (pc && pc.signalingState === "have-local-offer") {
          const weYield = this.currentGamertag.toLowerCase() > data.from.toLowerCase();
          if (weYield) {
            try { await pc.setLocalDescription({ type: "rollback" }); } 
            catch (e) { this.webrtc.closePeerConnection(data.from); pc = null; }
          } else { return; }
        }
        if (!pc) pc = await this.webrtc.createPeerConnection(data.from);
        if (pc.signalingState === "stable" || pc.signalingState === "have-remote-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          if (pc._pendingCandidates && pc._pendingCandidates.length > 0) {
            for (const candidate of pc._pendingCandidates) { await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{}); }
            pc._pendingCandidates = [];
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.ws.send(JSON.stringify({ type: "answer", answer: answer, from: this.currentGamertag, to: data.from }));
        }
        this.updateUI();
      } else if (data.type === "answer" && data.to === this.currentGamertag) {
        const pc = this.webrtc.getPeerConnection(data.from);
        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          if (pc._pendingCandidates && pc._pendingCandidates.length > 0) {
            for (const candidate of pc._pendingCandidates) { await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{}); }
            pc._pendingCandidates = [];
          }
        }
      } else if (data.type === "ice-candidate" && data.to === this.currentGamertag) {
        const pc = this.webrtc.getPeerConnection(data.from);
        if (pc && data.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(()=>{});
          } else {
            if (!pc._pendingCandidates) pc._pendingCandidates = [];
            pc._pendingCandidates.push(data.candidate);
          }
        }
      } else if (data.type === "participants-list") {
        for (const gt of data.list) {
          if (gt !== this.currentGamertag) {
            this.participantsManager.add(gt, false);
            if (!this.webrtc.getPeerConnection(gt)) {
              try {
                const pc = await this.webrtc.createPeerConnection(gt);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.ws.send(JSON.stringify({ type: "offer", offer: offer, from: this.currentGamertag, to: gt }));
              } catch (e) {}
            }
          }
        }
        this.updateUI();
      }
    } catch (e) {}
  }

  onWebSocketError() {
    this.ui.updateRoomInfo("❌ Connection error");
    this.exitCall();
  }

  onTrackReceived(participant) { this.updateUI(); }

  exitCall() {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: "leave", gamertag: this.currentGamertag }));
    this.webrtc.closeAllConnections();
    if (this.ws) { this.ws.close(); this.ws = null; }
    if (this.voiceDetector) { this.voiceDetector.dispose(); this.voiceDetector = null; }
    this.micManager.stop();
    this.participantsManager.clear();
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
    this.ui.showCallControls(false);
    this.ui.updateRoomInfo("");
    this.updateUI();
  }

  updateUI() {
    // OPTIMIZED: รวบการทำงานเพื่อไม่ให้เบราว์เซอร์ลาก (Rate limiting UI updates)
    if(this.uiUpdatePending) return;
    this.uiUpdatePending = true;
    
    requestAnimationFrame(() => {
      this.ui.updateGameStatus(this.minecraft.isInGame());
      this.ui.updateParticipantsList(this.participantsManager.getAll());
      this.uiUpdatePending = false;
    });
  }

}

// =====================================================
// INICIALIZACIÓN
// =====================================================
let app;
window.addEventListener("DOMContentLoaded", async () => {
  app = new VoiceChatApp();
  await app.init();
});
