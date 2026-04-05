// =====================================================
// EnviroVoice - script.js (Rebuilt)
// =====================================================

// =====================================================
// CLASS: VoiceDetector
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
    this.threshold = -30;
    this.silenceThreshold = -42;
    this.silenceDelay = 500;
    this.lastSpeakTime = 0;
    this.init();
  }

  async init() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.startDetection();
    } catch (error) {
      console.error('VoiceDetector init error:', error);
    }
  }

  getVolumeDb() {
    this.analyser.getByteTimeDomainData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = this.dataArray[i] - 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.dataArray.length);
    return 20 * Math.log10(rms / 128);
  }

  startDetection() {
    this.detectionInterval = setInterval(() => {
      const volumeDb = this.getVolumeDb();
      const now = Date.now();
      if (volumeDb > this.threshold) {
        this.lastSpeakTime = now;
        if (!this.isTalking) { this.isTalking = true; }
      } else if (volumeDb < this.silenceThreshold && this.isTalking) {
        if (now - this.lastSpeakTime > this.silenceDelay) { this.isTalking = false; }
      }
      if (this.onVoiceChange) this.onVoiceChange(this.isTalking, volumeDb);
    }, 100);
  }

  setSensitivity(level) {
    const map = {
      low:    { t: -40, s: -48 },
      medium: { t: -34, s: -44 },
      high:   { t: -30, s: -42 },
    };
    if (map[level]) {
      this.threshold = map[level].t;
      this.silenceThreshold = map[level].s;
    }
  }

  dispose() {
    if (this.detectionInterval) clearInterval(this.detectionInterval);
    if (this.microphone) this.microphone.disconnect();
    if (this.audioContext && this.audioContext.state !== 'closed') this.audioContext.close();
  }
}

// =====================================================
// CLASS: AudioEffectsManager
// =====================================================
class AudioEffectsManager {
  constructor() {
    this.reverb = null;
    this.filter = null;
    this.dynamicNodes = [];
    this.currentEffect = 'none';
    this.inputNode = null;
    this.processedStream = null;
    this.lastEffectChange = 0;
  }

  async init() {
    this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 });
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 1200 });
    await this.reverb.generate();
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

    const audioContext = Tone.context.rawContext || Tone.context._context;
    const dest = audioContext.createMediaStreamDestination();

    this.dynamicNodes.forEach(n => { try { n.disconnect(); if (n.dispose) n.dispose(); } catch(e){} });
    this.dynamicNodes = [];
    this.inputNode.disconnect();

    switch (effect) {
      case 'underwater':
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 500;
        this.reverb.wet.value = 0.5;
        this.inputNode.chain(this.filter, this.reverb, dest);
        break;
      case 'cave':
        const caveDelay = new Tone.FeedbackDelay('0.15', 0.35);
        const caveReverb = new Tone.Reverb({ decay: 5, wet: 0.6 });
        await caveReverb.ready;
        this.dynamicNodes.push(caveDelay, caveReverb);
        this.inputNode.chain(caveReverb, caveDelay, dest);
        break;
      case 'mountain':
        const mtnDelay = new Tone.FeedbackDelay('0.25', 0.25);
        const mtnReverb = new Tone.Reverb({ decay: 4, wet: 0.35 });
        await mtnReverb.ready;
        this.dynamicNodes.push(mtnDelay, mtnReverb);
        this.inputNode.chain(mtnReverb, mtnDelay, dest);
        break;
      case 'buried':
        const muffled = new Tone.Filter({ type: 'lowpass', frequency: 250, Q: 2 });
        const buriedReverb = new Tone.Reverb({ decay: 4, wet: 0.7 });
        await buriedReverb.ready;
        this.dynamicNodes.push(muffled, buriedReverb);
        this.inputNode.chain(muffled, buriedReverb, dest);
        break;
      default:
        const gate = new Tone.Gate(-45, 0.15);
        const hp = new Tone.Filter({ type: 'highpass', frequency: 80 });
        const lp = new Tone.Filter({ type: 'lowpass', frequency: 8000 });
        const comp = new Tone.Compressor(-28, 2.5);
        this.dynamicNodes.push(gate, hp, lp, comp);
        this.inputNode.chain(hp, gate, lp, comp, dest);
    }

    this.processedStream = dest.stream;
    this.currentEffect = effect;

    if (this.processedStream && peerConnections && peerConnections.size > 0) {
      const newTrack = this.processedStream.getAudioTracks()[0];
      if (!newTrack) return;
      const promises = [];
      peerConnections.forEach((pc, gt) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) promises.push(sender.replaceTrack(newTrack));
      });
      await Promise.all(promises);
    }
  }

  updateVolume(volume) {
    if (this.inputNode) this.inputNode.gain.value = volume;
  }

  getProcessedStream() { return this.processedStream; }
  getCurrentEffect() { return this.currentEffect; }
}

// =====================================================
// CLASS: MicrophoneManager
// =====================================================
class MicrophoneManager {
  constructor(audioEffects) {
    this.mediaStream = null;
    this.audioEffects = audioEffects;
    this.isMuted = false;
    this.currentDeviceId = null;
  }

  async start(deviceId = null, micVolume = 1.0) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser does not support audio capture. Please use HTTPS or a modern browser.');
    }
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    };
    this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.currentDeviceId = deviceId;

    const audioContext = Tone.context.rawContext || Tone.context._context;
    const source = audioContext.createMediaStreamSource(this.mediaStream);
    const inputNode = this.audioEffects.createInputNode(micVolume);
    source.connect(inputNode.input || inputNode);
    await this.audioEffects.applyEffect('none', null);
  }

  async changeMicrophone(deviceId) {
    this.stop();
    await this.start(deviceId, this.audioEffects.inputNode?.gain.value || 1.0);
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
    }
    return this.isMuted;
  }

  setEnabled(enabled) {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(t => t.enabled = enabled);
    }
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
  }

  getStream() { return this.mediaStream; }
  isMicMuted() { return this.isMuted; }

  static async getAudioInputDevices() {
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
      temp.getTracks().forEach(t => t.stop());
    } catch(e) {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  static async getAudioOutputDevices() {
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
      temp.getTracks().forEach(t => t.stop());
    } catch(e) {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audiooutput');
  }
}

// =====================================================
// CLASS: PushToTalkManager
// =====================================================
class PushToTalkManager {
  constructor(micManager, webrtcManager) {
    this.micManager = micManager;
    this.webrtcManager = webrtcManager;
    this.enabled = false;
    this.key = 'KeyV';
    this.keyDisplay = 'V';
    this.isKeyPressed = false;
    this.isTalking = false;
    this.onTalkingChange = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.isTalking = false;
      this.isKeyPressed = false;
      this._muteAll();
    } else {
      this.isTalking = true;
      this._unmuteAll();
    }
    this._notify();
  }

  _muteAll() {
    this.webrtcManager?.peerConnections?.forEach(pc => {
      pc.getSenders().forEach(s => { if (s.track?.kind === 'audio') s.track.enabled = false; });
    });
  }

  _unmuteAll() {
    this.webrtcManager?.peerConnections?.forEach(pc => {
      pc.getSenders().forEach(s => { if (s.track?.kind === 'audio') s.track.enabled = true; });
    });
  }

  setKey(key, display) {
    this.key = key;
    this.keyDisplay = display;
  }

  handleKeyDown(e) {
    if (!this.enabled || e.code !== this.key || this.isKeyPressed) return;
    this.isKeyPressed = true;
    this.isTalking = true;
    this._unmuteAll();
    this._notify();
  }

  handleKeyUp(e) {
    if (!this.enabled || e.code !== this.key || !this.isKeyPressed) return;
    this.isKeyPressed = false;
    this.isTalking = false;
    this._muteAll();
    this._notify();
  }

  _notify() {
    if (this.onTalkingChange) this.onTalkingChange(this.isTalking);
  }

  setOnTalkingChange(cb) { this.onTalkingChange = cb; }
  isEnabled() { return this.enabled; }
  isSpeaking() { return this.isTalking; }
}

// =====================================================
// CLASS: Participant
// =====================================================
class Participant {
  constructor(gamertag, isSelf = false) {
    this.gamertag = gamertag;
    this.isSelf = isSelf;
    this.distance = 0;
    this.volume = 1;
    this.gainNode = null;
    this.audioElement = null;
    this.customVolume = 1;
    this.skinUrl = `https://mc-api.io/render/face/${encodeURIComponent(gamertag)}/bedrock`;
    this.isTalking = false;
  }

  setAudioNodes(gainNode, audioElement) {
    this.gainNode = gainNode;
    this.audioElement = audioElement;
  }

  updateVolume(v) {
    const final = v * this.customVolume;
    this.volume = final;
    if (this.gainNode) this.gainNode.gain.value = final;
    else if (this.audioElement) this.audioElement.volume = Math.min(1, final);
  }

  setAudioOutput(deviceId) {
    if (this.audioElement && this.audioElement.setSinkId) {
      this.audioElement.setSinkId(deviceId).catch(e => console.warn('setSinkId error:', e));
    }
  }

  cleanup() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement.remove();
    }
  }

  getDisplayInfo() {
    return {
      gamertag: this.gamertag,
      isSelf: this.isSelf,
      distance: Math.round(this.distance),
      volume: this.volume,
      skinUrl: this.skinUrl,
      isTalking: this.isTalking,
    };
  }
}

// =====================================================
// CLASS: ParticipantsManager
// =====================================================
class ParticipantsManager {
  constructor() {
    this.participants = new Map();
    this.pendingNodes = new Map();
  }

  add(gamertag, isSelf = false) {
    if (this.participants.has(gamertag)) return;
    const p = new Participant(gamertag, isSelf);
    const pending = this.pendingNodes.get(gamertag);
    if (pending) {
      p.setAudioNodes(pending.gainNode, pending.audioElement);
      this.pendingNodes.delete(gamertag);
    }
    this.participants.set(gamertag, p);
  }

  remove(gamertag) {
    const p = this.participants.get(gamertag);
    if (p) { p.cleanup(); this.participants.delete(gamertag); }
  }

  get(gamertag) { return this.participants.get(gamertag); }
  has(gamertag) { return this.participants.has(gamertag); }
  getAll() { return Array.from(this.participants.values()); }
  forEach(cb) { this.participants.forEach(cb); }

  addPendingNode(gamertag, data) { this.pendingNodes.set(gamertag, data); }

  clear() {
    this.participants.forEach(p => p.cleanup());
    this.participants.clear();
    this.pendingNodes.clear();
  }

  setOutputDevice(deviceId) {
    this.participants.forEach(p => { if (!p.isSelf) p.setAudioOutput(deviceId); });
  }
}

// =====================================================
// CLASS: WebRTCManager
// =====================================================
class WebRTCManager {
  constructor(participantsManager, audioEffects, minecraft, onTrackReceived) {
    this.peerConnections = new Map();
    this.participantsManager = participantsManager;
    this.audioEffects = audioEffects;
    this.minecraft = minecraft;
    this.onTrackReceived = onTrackReceived;
    this.ws = null;
    this.currentGamertag = '';
    this.outputDeviceId = null;
  }

  setWebSocket(ws) { this.ws = ws; }
  setGamertag(gt) { this.currentGamertag = gt; }
  setOutputDevice(deviceId) { this.outputDeviceId = deviceId; }

  async createPeerConnection(remoteGt) {
    if (this.peerConnections.has(remoteGt)) return this.peerConnections.get(remoteGt);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      ]
    });

    pc._isInitialConnection = true;
    pc._reconnectAttempts = 0;

    pc.onicecandidate = (e) => {
      if (e.candidate && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate, from: this.currentGamertag, to: remoteGt }));
      }
    };

    pc.onnegotiationneeded = async () => {
      if (pc._isInitialConnection || pc.signalingState !== 'stable') return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ws?.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'offer', offer, from: this.currentGamertag, to: remoteGt }));
        }
      } catch(e) { console.error('Renegotiation error:', e); }
    };

    pc.ontrack = (event) => {
      const audio = document.createElement('audio');
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      audio.volume = 0;
      audio.id = `audio-${remoteGt}`;
      audio.style.display = 'none';
      document.body.appendChild(audio);

      if (this.outputDeviceId && audio.setSinkId) {
        audio.setSinkId(this.outputDeviceId).catch(() => {});
      }

      audio.play().catch(() => {});

      const p = this.participantsManager.get(remoteGt);
      if (p) {
        p.setAudioNodes(null, audio);
        p.updateVolume(0);
      } else {
        this.participantsManager.addPendingNode(remoteGt, { gainNode: null, audioElement: audio });
      }

      if (this.onTrackReceived) this.onTrackReceived(remoteGt);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        pc._isInitialConnection = false;
        pc._reconnectAttempts = 0;
        setTimeout(() => this.minecraft?.processUpdate(), 500);
      }
      if (pc.connectionState === 'failed') this._attemptReconnect(remoteGt);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };

    const stream = this.audioEffects.getProcessedStream();
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

    this.peerConnections.set(remoteGt, pc);
    return pc;
  }

  async _attemptReconnect(remoteGt) {
    const oldPc = this.peerConnections.get(remoteGt);
    const attempts = (oldPc?._reconnectAttempts || 0) + 1;
    if (attempts > 3) return;
    this.closePeerConnection(remoteGt);
    await new Promise(r => setTimeout(r, 1000));
    try {
      const pc = await this.createPeerConnection(remoteGt);
      pc._reconnectAttempts = attempts;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'offer', offer, from: this.currentGamertag, to: remoteGt }));
      }
    } catch(e) {}
  }

  async reconnectAllPeers() {
    const gts = Array.from(this.peerConnections.keys());
    this.closeAllConnections();
    await new Promise(r => setTimeout(r, 500));
    for (const gt of gts) {
      try {
        const pc = await this.createPeerConnection(gt);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ws?.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'offer', offer, from: this.currentGamertag, to: gt }));
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {}
    }
  }

  closePeerConnection(gt) {
    const pc = this.peerConnections.get(gt);
    if (pc) { pc.close(); this.peerConnections.delete(gt); }
  }

  closeAllConnections() {
    this.peerConnections.forEach((_, gt) => this.closePeerConnection(gt));
  }

  getPeerConnection(gt) { return this.peerConnections.get(gt); }
}

// =====================================================
// CLASS: DistanceCalculator
// =====================================================
class DistanceCalculator {
  constructor(maxDistance = 20) { this.maxDistance = maxDistance; }

  calculate(p1, p2) {
    const dx = p1.x - p2.x, dy = p1.y - p2.y, dz = p1.z - p2.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  volumeFromDistance(d) {
    if (d > this.maxDistance) return 0;
    return Math.pow(1 - d / this.maxDistance, 2);
  }
}

// =====================================================
// CLASS: MinecraftIntegration
// =====================================================
class MinecraftIntegration {
  constructor(participantsManager, audioEffects, micManager, distanceCalculator, webrtcManager) {
    this.participantsManager = participantsManager;
    this.audioEffects = audioEffects;
    this.micManager = micManager;
    this.distanceCalculator = distanceCalculator;
    this.webrtcManager = webrtcManager;
    this.minecraftData = null;
    this.currentGamertag = '';
    this.isPlayerInGame = false;
    this.remoteMuted = false;
    this.remoteDeafened = false;
    this.pushToTalkManager = null;
    this.lastMicVolume = null;
    this.lastEffectChange = 0;
    this.effectThrottleMs = 1000;
    this.onMuteChange = null;
    this.onDeafenChange = null;
  }

  setPushToTalkManager(ptt) { this.pushToTalkManager = ptt; }
  setGamertag(gt) { this.currentGamertag = gt; }
  setOnMuteChange(cb) { this.onMuteChange = cb; }
  setOnDeafenChange(cb) { this.onDeafenChange = cb; }

  updateData(data) {
    this.minecraftData = data;
    this.processUpdate();
  }

  processUpdate() {
    if (!this.minecraftData || !this.currentGamertag) return;
    const playersList = Array.isArray(this.minecraftData) ? this.minecraftData : this.minecraftData.players;
    if (!playersList) return;

    if (this.minecraftData.config?.maxDistance) {
      this.distanceCalculator.maxDistance = this.minecraftData.config.maxDistance;
    }

    const myPlayer = playersList.find(p => p.name.trim().toLowerCase() === this.currentGamertag.trim().toLowerCase());
    const wasInGame = this.isPlayerInGame;
    this.isPlayerInGame = !!myPlayer;

    if (!myPlayer) {
      if (wasInGame) console.log('Disconnected from Minecraft server');
      this.micManager.setEnabled(false);
      this.participantsManager.forEach(p => { if (!p.isSelf) p.updateVolume(0); });
      return;
    }

    const nowMuted = myPlayer.data?.isMuted || false;
    if (nowMuted !== this.remoteMuted) {
      this.remoteMuted = nowMuted;
      if (this.onMuteChange) this.onMuteChange(this.remoteMuted);
    }

    const nowDeafened = myPlayer.data?.isDeafened || false;
    if (nowDeafened !== this.remoteDeafened) {
      this.remoteDeafened = nowDeafened;
      if (this.onDeafenChange) this.onDeafenChange(this.remoteDeafened);
    }

    if (myPlayer.data?.micVolume !== undefined && myPlayer.data.micVolume !== this.lastMicVolume) {
      this.lastMicVolume = myPlayer.data.micVolume;
      this.audioEffects.updateVolume(myPlayer.data.micVolume);
    }

    if (!this.pushToTalkManager?.isEnabled()) {
      this.micManager.setEnabled(!this.micManager.isMicMuted() && !this.remoteMuted);
    }

    // Environmental effects
    const now = Date.now();
    if (now - this.lastEffectChange >= this.effectThrottleMs) {
      this.lastEffectChange = now;
      let fx = 'none';
      if (myPlayer.data?.isUnderWater) fx = 'underwater';
      else if (myPlayer.data?.isInCave) fx = 'cave';
      else if (myPlayer.data?.isInMountain) fx = 'mountain';
      else if (myPlayer.data?.isBuried) fx = 'buried';
      if (fx !== this.audioEffects.getCurrentEffect()) {
        this.audioEffects.applyEffect(fx, this.webrtcManager?.peerConnections);
      }
    }

    // Update participant volumes
    this.participantsManager.forEach((participant, gamertag) => {
      if (participant.isSelf) return;
      const other = playersList.find(pl => pl.name.trim().toLowerCase() === gamertag.trim().toLowerCase());
      if (other && !other.data?.isMuted && !this.remoteDeafened) {
        const dist = this.distanceCalculator.calculate(myPlayer.location, other.location);
        const vol = this.distanceCalculator.volumeFromDistance(dist);
        participant.distance = dist;
        participant.updateVolume(vol);
      } else {
        participant.updateVolume(0);
      }
    });
  }

  isInGame() { return this.isPlayerInGame; }
}

// =====================================================
// CLASS: UIManager (Rebuilt)
// =====================================================
class UIManager {
  constructor() {
    this.els = {
      gamertagInput:      document.getElementById('gamertagInput'),
      gamertagStatus:     document.getElementById('gamertagStatus'),
      roomUrlInput:       document.getElementById('roomUrlInput'),
      connectBtn:         document.getElementById('connectToRoomBtn'),
      roomInfo:           document.getElementById('roomInfo'),
      callControls:       document.getElementById('callControls'),
      setupSection:       document.getElementById('setupSection'),
      exitBtn:            document.getElementById('exitBtn'),
      micToggleBtn:       document.getElementById('micToggleBtn'),
      gameStatus:         document.getElementById('gameStatus'),
      participantsList:   document.getElementById('participantsList'),
      micSelector:        document.getElementById('micSelector'),
      outputSelector:     document.getElementById('outputSelector'),
      // PTT
      pttToggle:          document.getElementById('pttToggle'),
      pttModeOpen:        document.getElementById('pttModeOpen'),
      pttKeyBtn:          document.getElementById('pttKeyBtn'),
      pttKeyDisplay:      document.getElementById('pttKeyDisplay'),
      pttSection:         document.getElementById('pttSection'),
      pttKeyRow:          document.getElementById('pttKeyRow'),
      // Hold-to-Talk
      holdToTalkBtn:      document.getElementById('holdToTalkBtn'),
      holdToTalkContainer: document.getElementById('holdToTalkContainer'),
    };
    this.isPC = this._detectPC();
  }

  _detectPC() {
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    return !isMobile || !isTouch;
  }

  updateGamertagStatus(gt) {
    const el = this.els.gamertagStatus;
    if (!el) return;
    el.textContent = gt ? `✓ ${gt}` : '⚠️ Enter your gamertag';
    el.className = 'status-text ' + (gt ? 'ok' : 'warn');
  }

  updateRoomInfo(msg) {
    if (this.els.roomInfo) this.els.roomInfo.textContent = msg;
  }

  showCallControls(show) {
    if (this.els.setupSection) this.els.setupSection.style.display = show ? 'none' : 'block';
    if (this.els.callControls) this.els.callControls.style.display = show ? 'flex' : 'none';
    if (this.els.holdToTalkContainer) this.els.holdToTalkContainer.style.display = show ? 'flex' : 'none';
    if (show && this.isPC && this.els.pttSection) this.els.pttSection.style.display = 'block';
  }

  updateGameStatus(isInGame) {
    const el = this.els.gameStatus;
    if (!el) return;
    el.innerHTML = isInGame
      ? '<span class="status-dot ok"></span> Connected to Minecraft'
      : '<span class="status-dot warn"></span> Not connected to Minecraft';
  }

  updateParticipantsList(participants, voiceStates = {}) {
    const el = this.els.participantsList;
    if (!el) return;
    el.innerHTML = '';
    participants.forEach(p => {
      const info = p.getDisplayInfo();
      const isTalking = voiceStates[info.gamertag] || false;
      const card = document.createElement('div');
      card.className = 'participant-card' + (isTalking ? ' talking' : '');
      const volPct = Math.round(info.volume * 100);
      const volIcon = info.isSelf ? '' : (info.volume === 0 ? '🔇' : info.volume < 0.3 ? '🔉' : '🔊');
      const distText = info.isSelf ? '' : `<span class="p-dist">${info.distance}m</span>`;
      card.innerHTML = `
        <div class="p-avatar">
          <img src="${info.skinUrl}" alt="${info.gamertag}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
          <div class="p-avatar-fallback" style="display:none">👤</div>
          ${isTalking ? '<div class="talking-ring"></div>' : ''}
        </div>
        <div class="p-info">
          <span class="p-name">${info.gamertag}${info.isSelf ? ' <span class="you-badge">You</span>' : ''}</span>
          ${distText}
        </div>
        ${!info.isSelf ? `<span class="p-vol">${volIcon}</span>` : ''}
      `;
      el.appendChild(card);
    });
  }

  async populateMicSelector() {
    const el = this.els.micSelector;
    if (!el) return;
    const inputs = await MicrophoneManager.getAudioInputDevices();
    el.innerHTML = '';
    inputs.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${i+1}`;
      el.appendChild(opt);
    });
  }

  async populateOutputSelector() {
    const el = this.els.outputSelector;
    if (!el) return;
    const outputs = await MicrophoneManager.getAudioOutputDevices();
    if (outputs.length === 0) {
      el.innerHTML = '<option value="">Default Output</option>';
      return;
    }
    el.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'Default Output';
    el.appendChild(def);
    outputs.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Speaker ${i+1}`;
      el.appendChild(opt);
    });
  }

  getGamertag() { return this.els.gamertagInput?.value.trim() || ''; }
  getRoomUrl() { return this.els.roomUrlInput?.value.trim() || ''; }
  isPCDevice() { return this.isPC; }
}

// =====================================================
// CLASS: VoiceChatApp (Main)
// =====================================================
class VoiceChatApp {
  constructor() {
    this.ui = new UIManager();
    this.audioEffects = new AudioEffectsManager();
    this.micManager = new MicrophoneManager(this.audioEffects);
    this.participantsManager = new ParticipantsManager();
    this.distanceCalculator = new DistanceCalculator(20);
    this.voiceDetector = null;
    this.ws = null;
    this.currentGamertag = '';
    this.heartbeatInterval = null;
    this.voiceStates = {};
    this.micMode = 'open'; // 'open' | 'ptt'

    this.webrtc = new WebRTCManager(
      this.participantsManager,
      this.audioEffects,
      null,
      (gt) => this._onTrackReceived(gt)
    );

    this.pushToTalk = new PushToTalkManager(this.micManager, this.webrtc);

    this.minecraft = new MinecraftIntegration(
      this.participantsManager,
      this.audioEffects,
      this.micManager,
      this.distanceCalculator,
      this.webrtc
    );

    this.webrtc.minecraft = this.minecraft;
    this.minecraft.setPushToTalkManager(this.pushToTalk);

    this.minecraft.setOnMuteChange(() => this._updateUI());
    this.minecraft.setOnDeafenChange(() => this._updateUI());

    this.pushToTalk.setOnTalkingChange((isTalking) => {
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({
          type: 'ptt-status',
          gamertag: this.currentGamertag,
          isTalking,
          isMuted: !isTalking
        }));
      }
    });
  }

  async init() {
    this._checkHTTPS();
    await this.audioEffects.init();
    this._setupEventListeners();
    this._setupPTT();
    console.log('✓ EnviroVoice initialized');
  }

  _checkHTTPS() {
    const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
    if (!isLocal && window.location.protocol !== 'https:') {
      const bar = document.createElement('div');
      bar.className = 'https-warning';
      bar.textContent = '⚠️ Not using HTTPS — microphone may not work on mobile';
      document.body.prepend(bar);
    }
  }

  _setupEventListeners() {
    const { els } = this.ui;

    els.gamertagInput?.addEventListener('input', e => {
      this.currentGamertag = e.target.value.trim();
      this.ui.updateGamertagStatus(this.currentGamertag);
    });

    els.connectBtn?.addEventListener('click', async () => {
      if (Tone.context.state !== 'running') await Tone.start();
      this._connectToRoom();
    });

    els.exitBtn?.addEventListener('click', () => this._exitCall());

    // Mic toggle
    els.micToggleBtn?.addEventListener('click', () => {
      const muted = this.micManager.toggleMute();
      els.micToggleBtn.textContent = muted ? '🔇 Muted' : '🎤 Mic On';
      els.micToggleBtn.classList.toggle('muted', muted);
    });

    // Mic selector change
    els.micSelector?.addEventListener('change', async (e) => {
      const deviceId = e.target.value;
      if (!deviceId) return;
      try {
        await this.micManager.changeMicrophone(deviceId);
        if (this.voiceDetector) this.voiceDetector.dispose();
        const stream = this.micManager.getStream();
        if (stream) this._initVoiceDetector(stream);
        await this.webrtc.updateMicStream?.(this.micManager.getStream());
      } catch(e) { console.error('Mic change error:', e); }
    });

    // Output selector change
    els.outputSelector?.addEventListener('change', (e) => {
      const deviceId = e.target.value;
      this.webrtc.setOutputDevice(deviceId);
      this.participantsManager.setOutputDevice(deviceId);
    });

    // Hold-to-Talk button
    this._setupHoldToTalk();
  }

  _setupHoldToTalk() {
    const btn = this.ui.els.holdToTalkBtn;
    if (!btn) return;

    const start = (e) => {
      e.preventDefault();
      if (this.micManager.isMicMuted()) return;
      if (this.micMode !== 'ptt') return;
      btn.classList.add('pressing');
      this.webrtc.peerConnections.forEach(pc =>
        pc.getSenders().forEach(s => { if (s.track) s.track.enabled = true; })
      );
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'ptt-status', gamertag: this.currentGamertag, isTalking: true, isMuted: false }));
      }
    };

    const stop = (e) => {
      e.preventDefault();
      if (this.micMode !== 'ptt') return;
      btn.classList.remove('pressing');
      this.webrtc.peerConnections.forEach(pc =>
        pc.getSenders().forEach(s => { if (s.track) s.track.enabled = false; })
      );
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'ptt-status', gamertag: this.currentGamertag, isTalking: false, isMuted: true }));
      }
    };

    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', stop);
    btn.addEventListener('mouseleave', stop);
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('touchend', stop, { passive: false });
    btn.addEventListener('touchcancel', stop, { passive: false });
  }

  _setupPTT() {
    const { els } = this.ui;
    if (!this.ui.isPCDevice()) return;

    let listeningKey = false;
    let keyListener = null;

    // PTT enable toggle
    els.pttToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.micMode = enabled ? 'ptt' : 'open';
      this.pushToTalk.setEnabled(enabled);
      if (els.pttKeyRow) els.pttKeyRow.style.display = enabled ? 'flex' : 'none';
      if (els.holdToTalkContainer) {
        els.holdToTalkContainer.style.display = enabled ? 'flex' : 'none';
      }
      // Update open-mic mode label
      if (els.pttModeOpen) {
        els.pttModeOpen.classList.toggle('active', !enabled);
      }
    });

    // Open mic mode toggle (always-on)
    els.pttModeOpen?.addEventListener('click', () => {
      if (els.pttToggle) els.pttToggle.checked = false;
      this.micMode = 'open';
      this.pushToTalk.setEnabled(false);
      if (els.pttKeyRow) els.pttKeyRow.style.display = 'none';
      if (els.holdToTalkContainer) els.holdToTalkContainer.style.display = 'none';
      els.pttModeOpen.classList.add('active');
    });

    // Key picker
    els.pttKeyBtn?.addEventListener('click', () => {
      if (listeningKey) return;
      listeningKey = true;
      els.pttKeyBtn.textContent = 'Press any key...';
      els.pttKeyBtn.classList.add('listening');

      if (keyListener) document.removeEventListener('keydown', keyListener);
      keyListener = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const display = this._getKeyDisplay(e);
        this.pushToTalk.setKey(e.code, display);
        els.pttKeyBtn.textContent = display;
        els.pttKeyBtn.classList.remove('listening');
        if (els.pttKeyDisplay) els.pttKeyDisplay.textContent = `Hold ${display} to talk`;
        document.removeEventListener('keydown', keyListener);
        keyListener = null;
        listeningKey = false;
      };
      document.addEventListener('keydown', keyListener);
    });

    document.addEventListener('keydown', e => { if (!listeningKey) this.pushToTalk.handleKeyDown(e); });
    document.addEventListener('keyup', e => { if (!listeningKey) this.pushToTalk.handleKeyUp(e); });
  }

  _getKeyDisplay(e) {
    if (e.key.length === 1) return e.key.toUpperCase();
    const map = { Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT', Tab: 'TAB', Enter: 'ENTER' };
    return map[e.code] || e.code;
  }

  async _connectToRoom() {
    if (!this.currentGamertag) return alert('⚠️ Enter your gamertag');
    const url = this.ui.getRoomUrl();
    if (!url) return alert('⚠️ Enter a valid room URL');

    this.ui.updateRoomInfo('Connecting...');
    this.webrtc.closeAllConnections();
    if (this.ws) this.ws.close();

    try {
      const micDevice = this.ui.els.micSelector?.value || null;
      await this.micManager.start(micDevice, 1.0);
    } catch(e) {
      console.error('Mic error:', e);
      alert('❌ Could not access microphone.\n\n' + e.message);
      this.ui.updateRoomInfo('❌ Microphone error');
      return;
    }

    const stream = this.micManager.getStream();
    if (stream) this._initVoiceDetector(stream);

    this.webrtc.setGamertag(this.currentGamertag);
    this.minecraft.setGamertag(this.currentGamertag);

    const wsUrl = url.replace(/^http/, 'ws');
    this.ws = new WebSocket(wsUrl);
    this.webrtc.setWebSocket(this.ws);

    this.ws.onopen = () => this._onWsOpen();
    this.ws.onmessage = (msg) => this._onWsMessage(msg);
    this.ws.onerror = () => { this.ui.updateRoomInfo('❌ Connection error'); this._exitCall(); };
    this.ws.onclose = () => this._exitCall();
  }

  _initVoiceDetector(stream) {
    this.voiceDetector = new VoiceDetector(stream, (isTalking, volumeDb) => {
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'voice-detection', gamertag: this.currentGamertag, isTalking, volume: volumeDb }));
      }
    });
    this.voiceDetector.setSensitivity('high');
  }

  async _onWsOpen() {
    this.ui.updateRoomInfo('✅ Connected to voice chat');
    this.ws.send(JSON.stringify({ type: 'join', gamertag: this.currentGamertag }));
    this.ws.send(JSON.stringify({ type: 'request-participants' }));
    this.ws.send(JSON.stringify({ type: 'ptt-status', gamertag: this.currentGamertag, isTalking: true, isMuted: false }));

    this.ui.showCallControls(true);
    this.participantsManager.add(this.currentGamertag, true);

    await this.ui.populateMicSelector();
    await this.ui.populateOutputSelector();
    this._updateUI();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'heartbeat' }));
    }, 30000);
  }

  async _onWsMessage(msg) {
    const data = JSON.parse(msg.data);

    if (data.type === 'error') { alert('❌ ' + data.message); return; }

    if (data.type === 'minecraft-update') {
      if (data.data) this.minecraft.updateData(data.data);
      if (data.voiceStates) {
        this.voiceStates = {};
        data.voiceStates.forEach(vs => { this.voiceStates[vs.gamertag] = vs.isTalking; });
      }
      if (data.muteStates) {
        // handle mute states if needed
      }
      this._updateUI();
      return;
    }

    if (data.type === 'ptt-update') {
      this.voiceStates[data.gamertag] = data.isTalking;
      this._updateUI();
      return;
    }

    // Signaling
    if (data.type === 'join' && data.gamertag !== this.currentGamertag) {
      this.participantsManager.add(data.gamertag, false);
      if (!this.webrtc.getPeerConnection(data.gamertag)) {
        const pc = await this.webrtc.createPeerConnection(data.gamertag);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.ws.send(JSON.stringify({ type: 'offer', offer, from: this.currentGamertag, to: data.gamertag }));
      }
      this._updateUI();
    } else if (data.type === 'leave') {
      this.participantsManager.remove(data.gamertag);
      this.webrtc.closePeerConnection(data.gamertag);
      await this.webrtc.reconnectAllPeers();
      this._updateUI();
    } else if (data.type === 'offer' && data.to === this.currentGamertag) {
      this.participantsManager.add(data.from, false);
      const pc = await this.webrtc.createPeerConnection(data.from);
      if (pc.signalingState === 'stable' || pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.ws.send(JSON.stringify({ type: 'answer', answer, from: this.currentGamertag, to: data.from }));
      }
      this._updateUI();
    } else if (data.type === 'answer' && data.to === this.currentGamertag) {
      const pc = this.webrtc.getPeerConnection(data.from);
      if (pc?.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    } else if (data.type === 'ice-candidate' && data.to === this.currentGamertag) {
      const pc = this.webrtc.getPeerConnection(data.from);
      if (pc && data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else if (data.type === 'participants-list') {
      data.list.forEach(gt => { if (gt !== this.currentGamertag) this.participantsManager.add(gt, false); });
      this._updateUI();
    }
  }

  _onTrackReceived(gt) {
    this._updateUI();
  }

  _exitCall() {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'leave', gamertag: this.currentGamertag }));
    }
    this.webrtc.closeAllConnections();
    if (this.ws) { this.ws.close(); this.ws = null; }
    if (this.voiceDetector) { this.voiceDetector.dispose(); this.voiceDetector = null; }
    this.micManager.stop();
    this.participantsManager.clear();
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
    this.ui.showCallControls(false);
    this.ui.updateRoomInfo('');
    this._updateUI();
  }

  _updateUI() {
    this.ui.updateGameStatus(this.minecraft.isInGame());
    this.ui.updateParticipantsList(this.participantsManager.getAll(), this.voiceStates);
  }
}

// =====================================================
// INIT
// =====================================================
let app;
window.addEventListener('DOMContentLoaded', async () => {
  app = new VoiceChatApp();
  await app.init();
  window.debugAudio = () => {
    console.log('=== PARTICIPANTS ===');
    app.participantsManager.forEach((p, gt) => console.log(gt, { dist: p.distance, vol: p.volume }));
  };
});