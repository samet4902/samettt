/* ============================================================
   TROPİKAL BALIK - OKYANUS MACERASI
   Oyun Mantığı (script.js) - DÜZELTİLMİŞ SÜRÜM
   Düzeltme: Balığın konumu artık YALNIZCA JS transform ile
   yönetiliyor (CSS'te left/top yüzdesi kaldırıldı). fishX ve
   fishY, hem görsel render hem de çarpışma hesabı için TEK
   doğru kaynak (single source of truth). Ayrıca hitbox,
   gövdeden biraz içeri çekilerek daha adil hale getirildi.
   ============================================================ */

(function () {
    'use strict';

    /* ============================================================
       1) DOM REFERANSLARI
       ============================================================ */
    const gameContainer   = document.getElementById('game-container');
    const fishWrapper     = document.getElementById('fish-wrapper');
    const fishTail        = document.getElementById('fish-tail');
    const pipesLayer      = document.getElementById('pipes-layer');
    const bubblesLayer    = document.getElementById('bubbles-layer');
    const scoreDisplay    = document.getElementById('score-display');

    const startScreen     = document.getElementById('start-screen');
    const gameOverScreen  = document.getElementById('game-over-screen');
    const startButton     = document.getElementById('start-button');
    const restartButton   = document.getElementById('restart-button');

    const startBestScoreEl = document.getElementById('start-best-score');
    const finalScoreEl     = document.getElementById('final-score');
    const finalBestScoreEl = document.getElementById('final-best-score');
    const newRecordLabel   = document.getElementById('new-record-label');
    const tapHint          = document.getElementById('tap-hint');

    /* ============================================================
       2) OYUN SABİTLERİ (Fiziksel Ayarlar)
       ============================================================ */
    const GRAVITY            = 1500;
    const FLAP_VELOCITY       = -480;
    const MAX_FALL_SPEED      = 900;
    const MAX_RISE_SPEED      = -650;
    const ROTATION_MAX_DOWN   = 60;
    const ROTATION_MAX_UP     = -30;

    const PIPE_WIDTH          = 90;
    const PIPE_SPEED_BASE     = 200;
    const PIPE_SPEED_MAX      = 340;
    const PIPE_SPAWN_INTERVAL = 1650;
    const GAP_MIN             = 190;
    const GAP_MAX             = 260;
    const GAP_EDGE_MARGIN     = 70;

    const BUBBLE_SPAWN_MS     = 380;

    const STORAGE_KEY = 'tropicalFish_bestScore';

    // Hitbox oranları: gövdenin görsel kenarlarından biraz içeri
    // çekilmiş şekilde tanımlanır. Bu sayede balığın kuyruk/yüzgeç
    // uçları sütuma değiyormuş gibi görünse bile oyuncu "haksız"
    // bir çarpışma yaşamaz.
    const HITBOX_LEFT_RATIO   = 0.28;
    const HITBOX_RIGHT_RATIO  = 0.80;
    const HITBOX_TOP_RATIO    = 0.32;
    const HITBOX_BOTTOM_RATIO = 0.72;

    /* ============================================================
       3) OYUN DURUMU (State)
       ============================================================ */
    const state = {
        running: false,
        started: false,
        gameOver: false,
        fishY: 0,
        fishVelocity: 0,
        fishX: 0,
        score: 0,
        bestScore: 0,
        pipes: [],
        lastTime: 0,
        pipeSpawnTimer: 0,
        bubbleSpawnTimer: 0,
        containerWidth: 0,
        containerHeight: 0,
        fishSize: { w: 140, h: 90 },
        difficultyTime: 0,
        wasPausedByVisibility: false
    };

    /* ============================================================
       4) SES SİSTEMİ - Web Audio API
       ============================================================ */
    const AudioEngine = (function () {
        let ctx = null;

        function getCtx() {
            if (!ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                ctx = new AudioCtx();
            }
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
            return ctx;
        }

        function playTone({ freqStart, freqEnd = freqStart, duration = 0.15, type = 'sine', volume = 0.3, delay = 0 }) {
            try {
                const audioCtx = getCtx();
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();

                osc.type = type;
                const now = audioCtx.currentTime + delay;

                osc.frequency.setValueAtTime(freqStart, now);
                if (freqEnd !== freqStart) {
                    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + duration);
                }

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

                osc.connect(gain);
                gain.connect(audioCtx.destination);

                osc.start(now);
                osc.stop(now + duration + 0.05);
            } catch (e) {
                /* sessizce yok say */
            }
        }

        function playNoiseCrash() {
            try {
                const audioCtx = getCtx();
                const bufferSize = audioCtx.sampleRate * 0.4;
                const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                const data = buffer.getChannelData(0);

                for (let i = 0; i < bufferSize; i++) {
                    const decay = 1 - (i / bufferSize);
                    data[i] = (Math.random() * 2 - 1) * decay;
                }

                const noiseSource = audioCtx.createBufferSource();
                noiseSource.buffer = buffer;

                const filter = audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(900, audioCtx.currentTime);

                const gain = audioCtx.createGain();
                gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

                noiseSource.connect(filter);
                filter.connect(gain);
                gain.connect(audioCtx.destination);

                noiseSource.start();

                playTone({ freqStart: 140, freqEnd: 60, duration: 0.3, type: 'sawtooth', volume: 0.35 });
            } catch (e) {
                /* yoksay */
            }
        }

        return {
            swim() {
                playTone({ freqStart: 320, freqEnd: 520, duration: 0.12, type: 'sine', volume: 0.22 });
            },
            score() {
                playTone({ freqStart: 660, freqEnd: 880, duration: 0.1, type: 'triangle', volume: 0.28 });
                playTone({ freqStart: 880, freqEnd: 1180, duration: 0.12, type: 'triangle', volume: 0.22, delay: 0.08 });
            },
            crash() {
                playNoiseCrash();
            },
            unlock() {
                getCtx();
            }
        };
    })();

    /* ============================================================
       5) YARDIMCI FONKSİYONLAR
       ============================================================ */
    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function randInt(min, max) {
        return Math.floor(rand(min, max + 1));
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function loadBestScore() {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? parseInt(stored, 10) || 0 : 0;
    }

    function saveBestScore(value) {
        try {
            localStorage.setItem(STORAGE_KEY, String(value));
        } catch (e) {
            /* localStorage yoksa devam et */
        }
    }

    // Balığın x/y konumuna göre görsel transform'u tek yerden uygular.
    // Görsel konum ile fizik/çarpışma konumu HER ZAMAN bu fonksiyon
    // üzerinden senkron kalır.
    function renderFishTransform(rotationDeg) {
        fishWrapper.style.transform =
            `translate(${state.fishX}px, ${state.fishY}px) rotate(${rotationDeg}deg)`;
    }

    function updateContainerSize() {
        const rect = gameContainer.getBoundingClientRect();
        state.containerWidth = rect.width;
        state.containerHeight = rect.height;

        // Balığın x konumu sabit bir ekran yüzdesinde tutulur.
        // NOT: Bu değer artık CSS'te değil, sadece burada belirlenir.
        state.fishX = state.containerWidth * 0.18;

        // Balık boyutunu responsive CSS ile senkron tut.
        // fishWrapper üzerinde artık left/top olmadığı için
        // getBoundingClientRect genişlik/yükseklik olarak CSS'teki
        // width/height (ör. 140x90 veya mobilde 100x65) değerini verir.
        const fishRect = fishWrapper.getBoundingClientRect();
        state.fishSize.w = fishRect.width;
        state.fishSize.h = fishRect.height;
    }

    /* ============================================================
       6) MERCAN SÜTUNU (PIPE) ÜRETİMİ
       ============================================================ */
    function generateCoralPath(width, height, bumpCount, seedVariance) {
        let path = `M0,0 L${width},0 `;
        const segH = height / bumpCount;

        for (let i = 0; i <= bumpCount; i++) {
            const y = i * segH;
            const bumpOffset = Math.sin(i * seedVariance) * (width * 0.18) + rand(-width * 0.08, width * 0.08);
            const x = width + bumpOffset;
            path += `L${clamp(x, width * 0.6, width * 1.35)},${y.toFixed(1)} `;
        }
        path += `L${width},${height} L0,${height} Z`;
        return path;
    }

    const coralPalettes = [
        { main: '#ff6f61', dark: '#c73e30', light: '#ffb199' },
        { main: '#ff9e3d', dark: '#c76a1a', light: '#ffd199' },
        { main: '#7ee0c0', dark: '#3ba884', light: '#c5f5e6' },
        { main: '#c58bff', dark: '#8a4fd6', light: '#e6cfff' },
        { main: '#ffd166', dark: '#d6960e', light: '#ffe9b3' }
    ];

    function createPipeSVG(pieceWidth, pieceHeight, isTop, paletteIndex, uid) {
        const palette = coralPalettes[paletteIndex % coralPalettes.length];
        const bumpCount = randInt(4, 7);
        const seedVariance = rand(0.8, 1.6);

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('viewBox', `0 0 ${pieceWidth} ${pieceHeight}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.style.display = 'block';

        const gradId = `coralGrad_${uid}_${isTop ? 'top' : 'bot'}`;

        const defs = document.createElementNS(svgNS, 'defs');
        const gradient = document.createElementNS(svgNS, 'linearGradient');
        gradient.setAttribute('id', gradId);
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y2', '0%');

        const stop1 = document.createElementNS(svgNS, 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', palette.dark);

        const stop2 = document.createElementNS(svgNS, 'stop');
        stop2.setAttribute('offset', '45%');
        stop2.setAttribute('stop-color', palette.main);

        const stop3 = document.createElementNS(svgNS, 'stop');
        stop3.setAttribute('offset', '100%');
        stop3.setAttribute('stop-color', palette.light);

        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        gradient.appendChild(stop3);
        defs.appendChild(gradient);
        svg.appendChild(defs);

        const bodyPath = document.createElementNS(svgNS, 'path');
        const pathData = generateCoralPath(pieceWidth, pieceHeight, bumpCount, seedVariance);
        bodyPath.setAttribute('d', pathData);
        bodyPath.setAttribute('fill', `url(#${gradId})`);
        svg.appendChild(bodyPath);

        for (let i = 0; i < 3; i++) {
            const texLine = document.createElementNS(svgNS, 'path');
            const yPos = rand(pieceHeight * 0.15, pieceHeight * 0.85);
            const texD = `M0,${yPos} Q${pieceWidth * 0.4},${yPos + rand(-15, 15)} ${pieceWidth * 0.8},${yPos + rand(-10, 10)}`;
            texLine.setAttribute('d', texD);
            texLine.setAttribute('stroke', palette.dark);
            texLine.setAttribute('stroke-opacity', '0.3');
            texLine.setAttribute('stroke-width', '2');
            texLine.setAttribute('fill', 'none');
            svg.appendChild(texLine);
        }

        const detailCount = randInt(3, 6);
        for (let i = 0; i < detailCount; i++) {
            const circ = document.createElementNS(svgNS, 'circle');
            const cx = rand(pieceWidth * 0.2, pieceWidth * 0.75);
            const cy = rand(pieceHeight * 0.1, pieceHeight * 0.9);
            const r = rand(4, 10);
            circ.setAttribute('cx', cx);
            circ.setAttribute('cy', cy);
            circ.setAttribute('r', r);
            circ.setAttribute('fill', palette.light);
            circ.setAttribute('fill-opacity', '0.55');
            svg.appendChild(circ);
        }

        const capHeight = 26;
        const cap = document.createElementNS(svgNS, 'rect');
        cap.setAttribute('x', '0');
        cap.setAttribute('y', isTop ? (pieceHeight - capHeight) : 0);
        cap.setAttribute('width', pieceWidth * 1.15);
        cap.setAttribute('height', capHeight);
        cap.setAttribute('fill', palette.dark);
        cap.setAttribute('opacity', '0.85');
        cap.setAttribute('rx', '6');
        svg.appendChild(cap);

        return svg;
    }

    let pipeUidCounter = 0;

    function spawnPipe() {
        pipeUidCounter++;
        const uid = pipeUidCounter;

        const containerH = state.containerHeight;
        const gapHeight = rand(GAP_MIN, GAP_MAX);
        const maxGapTop = containerH - gapHeight - GAP_EDGE_MARGIN;
        const gapTop = rand(GAP_EDGE_MARGIN, Math.max(GAP_EDGE_MARGIN, maxGapTop));

        const pipeEl = document.createElement('div');
        pipeEl.className = 'pipe-pair';
        pipeEl.style.left = `${state.containerWidth}px`;

        const topEl = document.createElement('div');
        topEl.className = 'pipe-top';
        topEl.style.height = `${gapTop}px`;

        const bottomHeight = containerH - gapTop - gapHeight;
        const bottomEl = document.createElement('div');
        bottomEl.className = 'pipe-bottom';
        bottomEl.style.height = `${bottomHeight}px`;

        const paletteIndex = randInt(0, coralPalettes.length - 1);
        const topSVG = createPipeSVG(PIPE_WIDTH, Math.max(gapTop, 10), true, paletteIndex, uid);
        const bottomSVG = createPipeSVG(PIPE_WIDTH, Math.max(bottomHeight, 10), false, (paletteIndex + 1), uid);

        topEl.appendChild(topSVG);
        bottomEl.appendChild(bottomSVG);
        pipeEl.appendChild(topEl);
        pipeEl.appendChild(bottomEl);
        pipesLayer.appendChild(pipeEl);

        state.pipes.push({
            el: pipeEl,
            x: state.containerWidth,
            gapTop: gapTop,
            gapHeight: gapHeight,
            passed: false
        });
    }

    function removePipe(pipeData) {
        if (pipeData.el && pipeData.el.parentNode) {
            pipeData.el.parentNode.removeChild(pipeData.el);
        }
    }

    /* ============================================================
       7) KABARCIK ÜRETİMİ
       ============================================================ */
    function spawnBubble() {
        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        const size = rand(6, 22);
        bubble.style.width = `${size}px`;
        bubble.style.height = `${size}px`;
        bubble.style.left = `${rand(0, state.containerWidth)}px`;

        const duration = rand(4, 8);
        const delay = rand(0, 0.5);
        bubble.style.animationDuration = `${duration}s`;
        bubble.style.animationDelay = `${delay}s`;

        bubblesLayer.appendChild(bubble);

        const totalLifetime = (duration + delay) * 1000 + 100;
        setTimeout(() => {
            if (bubble.parentNode) {
                bubble.parentNode.removeChild(bubble);
            }
        }, totalLifetime);
    }

    /* ============================================================
       8) BALIK KONTROLÜ VE FİZİK
       ============================================================ */
    function flap() {
        if (state.gameOver) return;

        if (!state.started) {
            startGame();
            return;
        }

        state.fishVelocity = FLAP_VELOCITY;
        AudioEngine.swim();

        fishTail.style.animationDuration = '0.25s';
        clearTimeout(flap.resetTimer);
        flap.resetTimer = setTimeout(() => {
            fishTail.style.animationDuration = '0.45s';
        }, 200);
    }

    function updateFishPhysics(dt) {
        state.fishVelocity += GRAVITY * dt;
        state.fishVelocity = clamp(state.fishVelocity, MAX_RISE_SPEED, MAX_FALL_SPEED);
        state.fishY += state.fishVelocity * dt;

        const floorLimit = state.containerHeight - state.fishSize.h - 40;
        const ceilLimit = 0;

        if (state.fishY >= floorLimit) {
            state.fishY = floorLimit;
            triggerGameOver();
        }
        if (state.fishY <= ceilLimit) {
            state.fishY = ceilLimit;
            state.fishVelocity = 0;
        }

        const speedRatio = state.fishVelocity / MAX_FALL_SPEED;
        let rotation;
        if (state.fishVelocity < 0) {
            rotation = clamp((state.fishVelocity / MAX_RISE_SPEED) * ROTATION_MAX_UP, ROTATION_MAX_UP, 0);
        } else {
            rotation = clamp(speedRatio * ROTATION_MAX_DOWN, 0, ROTATION_MAX_DOWN);
        }

        renderFishTransform(rotation);
    }

    /* ============================================================
       9) SÜTUN HAREKETİ, ÇARPIŞMA VE SKOR
       ============================================================ */
    function currentPipeSpeed() {
        const progress = clamp(state.difficultyTime / 30, 0, 1);
        return PIPE_SPEED_BASE + (PIPE_SPEED_MAX - PIPE_SPEED_BASE) * progress;
    }

    function updatePipes(dt) {
        const speed = currentPipeSpeed();

        // Hitbox, fishX/fishY (yani transform ile GÖRÜNEN gerçek konum)
        // üzerinden hesaplanır. Böylece görsel ve mantıksal konum
        // birebir örtüşür.
        const fishLeft   = state.fishX + state.fishSize.w * HITBOX_LEFT_RATIO;
        const fishRight  = state.fishX + state.fishSize.w * HITBOX_RIGHT_RATIO;
        const fishTop    = state.fishY + state.fishSize.h * HITBOX_TOP_RATIO;
        const fishBottom = state.fishY + state.fishSize.h * HITBOX_BOTTOM_RATIO;

        for (let i = state.pipes.length - 1; i >= 0; i--) {
            const pipe = state.pipes[i];
            pipe.x -= speed * dt;
            pipe.el.style.left = `${pipe.x}px`;

            if (!pipe.passed && (pipe.x + PIPE_WIDTH) < state.fishX) {
                pipe.passed = true;
                incrementScore();
            }

            const pipeLeft = pipe.x;
            const pipeRight = pipe.x + PIPE_WIDTH;
            const overlapsX = fishRight > pipeLeft && fishLeft < pipeRight;

            if (overlapsX) {
                const gapTopY = pipe.gapTop;
                const gapBottomY = pipe.gapTop + pipe.gapHeight;
                const hitsTop = fishTop < gapTopY;
                const hitsBottom = fishBottom > gapBottomY;

                if (hitsTop || hitsBottom) {
                    triggerGameOver();
                }
            }

            if (pipe.x < -PIPE_WIDTH - 20) {
                removePipe(pipe);
                state.pipes.splice(i, 1);
            }
      }
