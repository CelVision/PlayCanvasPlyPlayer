import * as pc from 'playcanvas';

// --- Application Setup ---
const canvas = document.getElementById('application');
const app = new pc.Application(canvas);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.start();

// Configure window resize handler
window.addEventListener('resize', () => {
    app.resizeCanvas();
});

// --- Camera & Navigation Controls ---
const camera = new pc.Entity('camera');
camera.addComponent('camera', {
    clearColor: new pc.Color(0.12, 0.12, 0.18, 1.0) // Match UI theme #1e1e2e
});
app.root.addChild(camera);

// Camera Navigation State
let cameraYaw = 0;
let cameraPitch = 0;

// Camera Waypoint Warping State
let isWarping = false;
const warpDuration = 0.8; // Smooth 0.8 seconds warp
let warpTimer = 0;
const warpStartPos = new pc.Vec3();
const warpEndPos = new pc.Vec3();
let warpStartPitch = 0;
let warpEndPitch = 0;
let warpStartYaw = 0;
let warpEndYaw = 0;
let warpCallback = null;
let warpModelEntity = null;
const warpStartModelPos = new pc.Vec3();
const warpEndModelPos = new pc.Vec3();
const warpStartModelRot = new pc.Vec3();
const warpEndModelRot = new pc.Vec3();
let warpStartModelScale = 1;
let warpEndModelScale = 1;
let warpStartFov = 45;
let warpEndFov = 45;

// Camera Path Playback State
let isPlayingPath = false;
let pathState = 'moving'; // 'moving' or 'stopped'
let currentPathSegment = 0;
let pathSegmentTimer = 0;
let pathWaitTimer = 0;
let currentWaitDuration = 0;
const segmentDuration = 2.5; // 2.5 seconds per waypoint segment

// Set initial camera position
camera.setPosition(0, 1.5, 5);
camera.setEulerAngles(cameraPitch, cameraYaw, 0);

// Function to update camera rotation based on free-look state
function updateCameraRotation() {
    camera.setEulerAngles(cameraPitch, cameraYaw, 0);
}

// Cancel any active automated transitions (warps, play paths) on user manual input
function cancelCameraAutomation() {
    isWarping = false;
    warpCallback = null;
    if (isPlayingPath) {
        stopPathPlayback();
    }
}

// --- Mouse Drag and Wheel Interaction for Navigation ---
let isDragging = false;
let dragMode = 'look'; // 'look' or 'pan'
let lastMouseX = 0;
let lastMouseY = 0;

// Disable standard context menu on canvas so right click drag pans smoothly
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    cancelCameraAutomation();
    if (e.button === 0 && !e.shiftKey) { // Left click (without Shift) -> Free-look
        isDragging = true;
        dragMode = 'look';
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    } else if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) { // Right/Middle click or Shift+Left -> Pan
        isDragging = true;
        dragMode = 'pan';
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

window.addEventListener('mousemove', (e) => {
    if (isDragging) {
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;

        if (dragMode === 'look') {
            cameraYaw += deltaX * 0.15;
            cameraPitch -= deltaY * 0.15;
            updateCameraRotation();
        } else if (dragMode === 'pan') {
            const factor = 0.005; // Fixed panning speed
            const right = camera.right;
            const up = camera.up;
            const pos = camera.getPosition();

            pos.x += (-right.x * deltaX + up.x * deltaY) * factor;
            pos.y += (-right.y * deltaX + up.y * deltaY) * factor;
            pos.z += (-right.z * deltaX + up.z * deltaY) * factor;
            
            camera.setPosition(pos);
        }

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
    cancelCameraAutomation();
    // Translate forward/backward along camera local direction
    const speed = e.deltaY * 0.005;
    camera.translateLocal(0, 0, speed);
});

// Support touchscreen devices as well
let lastTouchDist = 0;
canvas.addEventListener('touchstart', (e) => {
    cancelCameraAutomation();
    if (e.touches.length === 1) {
        isDragging = true;
        dragMode = 'look';
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        isDragging = true;
        dragMode = 'pan';
        // Compute last touch distance for pinch zoom
        lastTouchDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        // Also compute midpoint for panning
        lastMouseX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
        lastMouseY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (isDragging) {
        if (e.touches.length === 1 && dragMode === 'look') {
            const deltaX = e.touches[0].clientX - lastMouseX;
            const deltaY = e.touches[0].clientY - lastMouseY;

            cameraYaw += deltaX * 0.15;
            cameraPitch -= deltaY * 0.15;
            updateCameraRotation();

            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            // Pinch to zoom (move forward/backward)
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const factor = lastTouchDist / dist;
            camera.translateLocal(0, 0, (factor - 1) * 2.0);
            lastTouchDist = dist;

            // Two-finger drag to pan
            const midX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
            const deltaX = midX - lastMouseX;
            const deltaY = midY - lastMouseY;

            const panFactor = 0.005;
            const right = camera.right;
            const up = camera.up;
            const pos = camera.getPosition();

            pos.x += (-right.x * deltaX + up.x * deltaY) * panFactor;
            pos.y += (-right.y * deltaX + up.y * deltaY) * panFactor;
            pos.z += (-right.z * deltaX + up.z * deltaY) * panFactor;

            camera.setPosition(pos);

            lastMouseX = midX;
            lastMouseY = midY;
        }
    }
});

canvas.addEventListener('touchend', () => {
    isDragging = false;
    lastTouchDist = 0;
});

// --- Keyboard Navigation WASD State ---
const activeKeys = {};
window.addEventListener('keydown', (e) => {
    cancelCameraAutomation();
    
    // Guard against non-string keys
    if (typeof e.key === 'string') {
        activeKeys[e.key.toLowerCase()] = true;

        if (e.key === '+' || e.key === '=') {
            const fov = Math.max(10, camera.camera.fov - 1);
            updateZoomHUD(fov);
        } else if (e.key === '-' || e.key === '_') {
            const fov = Math.min(110, camera.camera.fov + 1);
            updateZoomHUD(fov);
        }
    }
});
window.addEventListener('keyup', (e) => {
    if (typeof e.key === 'string') {
        activeKeys[e.key.toLowerCase()] = false;
    }
});

// Register frame update loop to handle smooth WASD keyboard movement
app.on('update', (dt) => {
    if (isWarping) {
        warpTimer += dt;
        let t = warpTimer / warpDuration;
        if (t >= 1) {
            t = 1;
            isWarping = false;
            if (warpCallback) {
                const cb = warpCallback;
                warpCallback = null;
                cb();
            }
        }

        const ease = t * t * (3 - 2 * t); // smoothstep interpolation

        const currentPos = new pc.Vec3();
        currentPos.lerp(warpStartPos, warpEndPos, ease);
        camera.setPosition(currentPos);

        cameraPitch = pc.math.lerp(warpStartPitch, warpEndPitch, ease);
        cameraYaw = pc.math.lerp(warpStartYaw, warpEndYaw, ease);
        updateCameraRotation();

        const currentFov = pc.math.lerp(warpStartFov, warpEndFov, ease);
        updateZoomHUD(currentFov);

        if (warpModelEntity) {
            const currentModelPos = new pc.Vec3();
            currentModelPos.lerp(warpStartModelPos, warpEndModelPos, ease);
            warpModelEntity.setPosition(currentModelPos);

            const rx = pc.math.lerp(warpStartModelRot.x, warpEndModelRot.x, ease);
            const ry = pc.math.lerp(warpStartModelRot.y, warpEndModelRot.y, ease);
            const rz = pc.math.lerp(warpStartModelRot.z, warpEndModelRot.z, ease);
            warpModelEntity.setEulerAngles(rx, ry, rz);

            const currentScale = pc.math.lerp(warpStartModelScale, warpEndModelScale, ease);
            warpModelEntity.setLocalScale(currentScale, currentScale, currentScale);

            // Update UI sliders/labels if this model is selected
            if (activeModelId) {
                const activeModel = loadedModels.find(m => m.id === activeModelId);
                if (activeModel && activeModel.entity === warpModelEntity) {
                    controlPosX.value = currentModelPos.x;
                    controlPosY.value = currentModelPos.y;
                    controlPosZ.value = currentModelPos.z;
                    controlScale.value = currentScale;
                    controlRotX.value = rx;
                    controlRotY.value = ry;
                    controlRotZ.value = rz;

                    inputPosX.value = currentModelPos.x.toFixed(1);
                    inputPosY.value = currentModelPos.y.toFixed(1);
                    inputPosZ.value = currentModelPos.z.toFixed(1);
                    inputScale.value = currentScale.toFixed(2);
                    inputRotX.value = Math.round(rx);
                    inputRotY.value = Math.round(ry);
                    inputRotZ.value = Math.round(rz);
                }
            }
        }
        
        return;
    }

    if (isPlayingPath) {
        if (pathState === 'moving') {
            pathSegmentTimer += dt;
            let t = pathSegmentTimer / segmentDuration;
            
            const currentShot = cameraShots[currentPathSegment];
            const nextShot = cameraShots[currentPathSegment + 1];

            if (t >= 1) {
                t = 1;
                camera.setPosition(nextShot.position);
                cameraPitch = nextShot.pitch;
                cameraYaw = nextShot.yaw;
                updateCameraRotation();
                updateZoomHUD(nextShot.fov ?? 45);

                if (nextShot.modelTransform) {
                    const model = loadedModels.find(m => m.name === nextShot.modelTransform.name) || loadedModels.find(m => m.id === nextShot.modelTransform.id);
                    if (model) {
                        selectModel(model.id, true);
                        model.entity.setPosition(nextShot.modelTransform.position.x, nextShot.modelTransform.position.y, nextShot.modelTransform.position.z);
                        model.entity.setEulerAngles(nextShot.modelTransform.rotation.x, nextShot.modelTransform.rotation.y, nextShot.modelTransform.rotation.z);
                        model.entity.setLocalScale(nextShot.modelTransform.scale, nextShot.modelTransform.scale, nextShot.modelTransform.scale);

                        if (activeModelId === model.id) {
                            controlPosX.value = nextShot.modelTransform.position.x;
                            controlPosY.value = nextShot.modelTransform.position.y;
                            controlPosZ.value = nextShot.modelTransform.position.z;
                            controlScale.value = nextShot.modelTransform.scale;
                            controlRotX.value = nextShot.modelTransform.rotation.x;
                            controlRotY.value = nextShot.modelTransform.rotation.y;
                            controlRotZ.value = nextShot.modelTransform.rotation.z;

                            inputPosX.value = nextShot.modelTransform.position.x.toFixed(1);
                            inputPosY.value = nextShot.modelTransform.position.y.toFixed(1);
                            inputPosZ.value = nextShot.modelTransform.position.z.toFixed(1);
                            inputScale.value = nextShot.modelTransform.scale.toFixed(2);
                            inputRotX.value = Math.round(nextShot.modelTransform.rotation.x);
                            inputRotY.value = Math.round(nextShot.modelTransform.rotation.y);
                            inputRotZ.value = Math.round(nextShot.modelTransform.rotation.z);
                        }
                    }
                }

                // Arrived at nextShot. Check if we should wait at nextShot
                const nextWait = nextShot.stopDuration ?? 0;
                if (nextWait > 0) {
                    pathState = 'stopped';
                    pathWaitTimer = 0;
                    currentWaitDuration = nextWait;
                } else {
                    currentPathSegment++;
                    if (currentPathSegment >= cameraShots.length - 1) {
                        stopPathPlayback();
                        return;
                    }
                    pathSegmentTimer = 0;
                }
                return;
            }

            // Dynamic easing based on stop durations of the current and next waypoints
            let ease;
            const startStop = currentShot.stopDuration ?? 0;
            const endStop = nextShot.stopDuration ?? 0;

            if (startStop > 0 && endStop > 0) {
                // Decelerate at start and end
                ease = t * t * (3 - 2 * t);
            } else if (startStop > 0 && endStop === 0) {
                // Accelerate from stop, end at continuous velocity
                ease = t * t * (2 - t);
            } else if (startStop === 0 && endStop > 0) {
                // Start at continuous velocity, decelerate to stop
                ease = t * (1 + t - t * t);
            } else {
                // Nonstop constant velocity
                ease = t;
            }

            const currentPos = new pc.Vec3();
            currentPos.lerp(currentShot.position, nextShot.position, ease);
            camera.setPosition(currentPos);

            // Yaw shortest path interpolation
            let yawDiff = nextShot.yaw - currentShot.yaw;
            while (yawDiff < -180) yawDiff += 360;
            while (yawDiff > 180) yawDiff -= 360;
            const targetYaw = currentShot.yaw + yawDiff;

            cameraPitch = pc.math.lerp(currentShot.pitch, nextShot.pitch, ease);
            cameraYaw = pc.math.lerp(currentShot.yaw, targetYaw, ease);
            updateCameraRotation();

            // Smoothly interpolate camera fov (zoom)
            const currentFov = pc.math.lerp(currentShot.fov ?? 45, nextShot.fov ?? 45, ease);
            updateZoomHUD(currentFov);

            // Smoothly interpolate model transform if defined on both shots
            if (currentShot.modelTransform && nextShot.modelTransform) {
                const model = loadedModels.find(m => m.name === nextShot.modelTransform.name) || loadedModels.find(m => m.id === nextShot.modelTransform.id);
                if (model) {
                    selectModel(model.id, true);

                    const p1 = new pc.Vec3(currentShot.modelTransform.position.x, currentShot.modelTransform.position.y, currentShot.modelTransform.position.z);
                    const p2 = new pc.Vec3(nextShot.modelTransform.position.x, nextShot.modelTransform.position.y, nextShot.modelTransform.position.z);

                    const currentModelPos = new pc.Vec3();
                    currentModelPos.lerp(p1, p2, ease);
                    model.entity.setPosition(currentModelPos);

                    const r1 = currentShot.modelTransform.rotation;
                    const r2 = nextShot.modelTransform.rotation;

                    let rxDiff = r2.x - r1.x;
                    while (rxDiff < -180) rxDiff += 360;
                    while (rxDiff > 180) rxDiff -= 360;
                    const targetRx = r1.x + rxDiff;

                    let ryDiff = r2.y - r1.y;
                    while (ryDiff < -180) ryDiff += 360;
                    while (ryDiff > 180) ryDiff -= 360;
                    const targetRy = r1.y + ryDiff;

                    let rzDiff = r2.z - r1.z;
                    while (rzDiff < -180) rzDiff += 360;
                    while (rzDiff > 180) rzDiff -= 360;
                    const targetRz = r1.z + rzDiff;

                    const rx = pc.math.lerp(r1.x, targetRx, ease);
                    const ry = pc.math.lerp(r1.y, targetRy, ease);
                    const rz = pc.math.lerp(r1.z, targetRz, ease);
                    model.entity.setEulerAngles(rx, ry, rz);

                    const currentScale = pc.math.lerp(currentShot.modelTransform.scale, nextShot.modelTransform.scale, ease);
                    model.entity.setLocalScale(currentScale, currentScale, currentScale);

                    if (activeModelId === model.id) {
                        controlPosX.value = currentModelPos.x;
                        controlPosY.value = currentModelPos.y;
                        controlPosZ.value = currentModelPos.z;
                        controlScale.value = currentScale;
                        controlRotX.value = rx;
                        controlRotY.value = ry;
                        controlRotZ.value = rz;

                        inputPosX.value = currentModelPos.x.toFixed(1);
                        inputPosY.value = currentModelPos.y.toFixed(1);
                        inputPosZ.value = currentModelPos.z.toFixed(1);
                        inputScale.value = currentScale.toFixed(2);
                        inputRotX.value = Math.round(rx);
                        inputRotY.value = Math.round(ry);
                        inputRotZ.value = Math.round(rz);
                    }
                }
            }
        } else if (pathState === 'stopped') {
            pathWaitTimer += dt;
            if (pathWaitTimer >= currentWaitDuration) {
                // Done waiting. Proceed to next segment
                currentPathSegment++;
                if (currentPathSegment >= cameraShots.length - 1) {
                    stopPathPlayback();
                    return;
                }
                pathState = 'moving';
                pathSegmentTimer = 0;
                currentWaitDuration = 0;
            }
        }
        
        return;
    }

    let moveForward = 0;
    let moveRight = 0;
    let moveUp = 0;

    if (activeKeys['w'] || activeKeys['arrowup']) moveForward += 1;
    if (activeKeys['s'] || activeKeys['arrowdown']) moveForward -= 1;
    if (activeKeys['a'] || activeKeys['arrowleft']) moveRight -= 1;
    if (activeKeys['d'] || activeKeys['arrowright']) moveRight += 1;
    if (activeKeys['q']) moveUp -= 1;
    if (activeKeys['e'] || activeKeys[' ']) moveUp += 1; // space bar is ' '

    if (moveForward !== 0 || moveRight !== 0 || moveUp !== 0) {
        const speed = 4.0 * dt; // constant speed in meters per second

        if (moveForward !== 0) {
            camera.translateLocal(0, 0, -moveForward * speed);
        }
        if (moveRight !== 0) {
            camera.translateLocal(moveRight * speed, 0, 0);
        }
        if (moveUp !== 0) {
            camera.translateLocal(0, moveUp * speed, 0);
        }
    }

    updateCameraStats();
});

// --- Model Management & State ---
const loadedModels = []; // Array of { id, file, entity, asset, visible: boolean }
let activeModelId = null;

// UI Elements
const fileInput = document.getElementById('file-input');
const modelsContainer = document.getElementById('models-container');
const activeControls = document.getElementById('active-controls');
const activeModelNameLabel = document.getElementById('active-model-name');
const statsCountLabel = document.getElementById('stats-count');
const cameraPosStat = document.getElementById('camera-pos-stat');
const cameraRotStat = document.getElementById('camera-rot-stat');
const cameraZoomStat = document.getElementById('camera-zoom-stat');
const bgColorPicker = document.getElementById('bg-color');

// Control sliders
const controlPosX = document.getElementById('control-pos-x');
const controlPosY = document.getElementById('control-pos-y');
const controlPosZ = document.getElementById('control-pos-z');
const controlScale = document.getElementById('control-scale');
const controlRotX = document.getElementById('control-rot-x');
const controlRotY = document.getElementById('control-rot-y');
const controlRotZ = document.getElementById('control-rot-z');
const controlZoom = document.getElementById('control-zoom');

// Value Inputs (bidirectional numeric entry)
const inputPosX = document.getElementById('input-pos-x');
const inputPosY = document.getElementById('input-pos-y');
const inputPosZ = document.getElementById('input-pos-z');
const inputScale = document.getElementById('input-scale');
const inputRotX = document.getElementById('input-rot-x');
const inputRotY = document.getElementById('input-rot-y');
const inputRotZ = document.getElementById('input-rot-z');
const inputZoom = document.getElementById('input-zoom');

if (controlZoom) {
    controlZoom.addEventListener('input', () => {
        const fov = parseFloat(controlZoom.value);
        camera.camera.fov = fov;
        if (inputZoom) {
            inputZoom.value = Math.round(fov);
        }
    });
}

if (inputZoom) {
    inputZoom.addEventListener('input', () => {
        const fov = Math.min(110, Math.max(10, parseFloat(inputZoom.value) || 45));
        controlZoom.value = fov;
        camera.camera.fov = fov;
    });
}

function updateZoomHUD(fov) {
    if (controlZoom) {
        controlZoom.value = fov;
    }
    if (inputZoom) {
        inputZoom.value = Math.round(fov);
    }
    camera.camera.fov = fov;
}

// Background Color Picker Change
bgColorPicker.addEventListener('input', (e) => {
    const hex = e.target.value;
    const r = parseInt(hex.substring(1, 3), 16) / 255;
    const g = parseInt(hex.substring(3, 5), 16) / 255;
    const b = parseInt(hex.substring(5, 7), 16) / 255;
    camera.camera.clearColor = new pc.Color(r, g, b, 1.0);
});

// --- Uploading and Parsing .ply files ---
fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files.length) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.toLowerCase().endsWith('.ply')) {
            loadPlyFile(file);
        }
    }
    fileInput.value = ''; // Reset file input
});

function loadPlyFile(file) {
    const modelId = 'model-' + Math.random().toString(36).substring(2, 9);
    
    // Create Blob URL for local file loading
    const blobUrl = URL.createObjectURL(file);

    // Create a new PlayCanvas asset of type 'gsplat' (Gaussian Splatting)
    const asset = new pc.Asset(file.name, 'gsplat', {
        url: blobUrl
    });

    // Add asset to project registry
    app.assets.add(asset);

    // Render loading indicator in UI list
    const modelItem = document.createElement('div');
    modelItem.id = `item-${modelId}`;
    modelItem.className = 'model-item';
    modelItem.innerHTML = `
        <div class="model-item-header">
            <span class="model-name">${file.name}</span>
            <span style="font-size: 0.75rem; color: #3b82f6;">Loading...</span>
        </div>
    `;
    
    // If empty-list-text is present, remove it
    const emptyText = modelsContainer.querySelector('.empty-list-text');
    if (emptyText) {
        emptyText.remove();
    }
    modelsContainer.appendChild(modelItem);

    asset.ready((loadedAsset) => {
        // Create an entity to render this Gaussian Splat
        const entity = new pc.Entity(file.name);
        entity.addComponent('gsplat', {
            asset: loadedAsset
        });

        // Add to application root hierarchy
        app.root.addChild(entity);

        // Store model in active state
        const modelData = {
            id: modelId,
            name: file.name,
            entity: entity,
            asset: loadedAsset,
            visible: true
        };
        loadedModels.push(modelData);

        // Update loading UI item with full controls
        updateModelUIItem(modelData);
        updateStats();

        // Automatically select the newly loaded model
        selectModel(modelId);

        // Position camera to look at the newly added model
        // Try to automatically guess a good distance based on splat bounding box (if present)
        setTimeout(() => {
            if (entity.gsplat && entity.gsplat.instance) {
                const aabb = entity.gsplat.instance.aabb;
                if (aabb) {
                    const dist = Math.max(aabb.halfExtents.length() * 2.5, 3);
                    camera.setPosition(aabb.center.x, aabb.center.y, aabb.center.z + dist);
                    camera.lookAt(aabb.center);
                    const euler = camera.getEulerAngles();
                    cameraYaw = euler.y;
                    cameraPitch = euler.x;
                }
            }
        }, 100);
    });

    asset.once('error', (err) => {
        console.error('Failed to load PLY model:', err);
        modelItem.innerHTML = `
            <div class="model-item-header">
                <span class="model-name" style="color: #ef4444;">${file.name}</span>
                <span style="font-size: 0.75rem; color: #ef4444;">Failed</span>
            </div>
        `;
        setTimeout(() => {
            modelItem.remove();
            if (modelsContainer.children.length === 0) {
                modelsContainer.innerHTML = '<div class="empty-list-text">No models loaded yet. Upload some above!</div>';
            }
        }, 3000);
    });

    // Start loading the asset
    app.assets.load(asset);
}

// --- Dynamic UI Management ---
function updateModelUIItem(model) {
    const item = document.getElementById(`item-${model.id}`);
    if (!item) return;

    item.innerHTML = `
        <div class="model-item-header">
            <span class="model-name" id="name-${model.id}" style="cursor: pointer;">${model.name}</span>
            <div class="model-actions">
                <button type="button" class="action-btn ${model.visible ? 'active' : ''}" id="vis-${model.id}" title="Toggle Visibility">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </button>
                <button type="button" class="action-btn" id="del-${model.id}" title="Delete Model" style="color: #ef4444;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 3 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </div>
    `;

    // Click on name to select
    document.getElementById(`name-${model.id}`).addEventListener('click', () => {
        selectModel(model.id);
    });

    // Toggle visibility button
    const visBtn = document.getElementById(`vis-${model.id}`);
    visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleModelVisibility(model.id);
    });

    // Delete button
    const delBtn = document.getElementById(`del-${model.id}`);
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteModel(model.id);
    });
}

function selectModel(modelId, suppressCameraLookAt = false) {
    activeModelId = modelId;
    
    // Highlight active item in UI list
    const items = modelsContainer.getElementsByClassName('model-item');
    for (let i = 0; i < items.length; i++) {
        items[i].classList.remove('active');
    }
    
    const activeItem = document.getElementById(`item-${modelId}`);
    if (activeItem) {
        activeItem.classList.add('active');
    }

    const model = loadedModels.find(m => m.id === modelId);
    if (model) {
        // Show active transform controls
        activeControls.style.display = 'flex';
        activeModelNameLabel.textContent = model.name;

        // Set control values to model's current transform
        const pos = model.entity.getPosition();
        const scale = model.entity.getLocalScale().x; // Uniform scale
        const rot = model.entity.getEulerAngles();

        controlPosX.value = pos.x;
        controlPosY.value = pos.y;
        controlPosZ.value = pos.z;
        controlScale.value = scale;
        controlRotX.value = rot.x;
        controlRotY.value = rot.y;
        controlRotZ.value = rot.z;

        // Update value inputs
        inputPosX.value = pos.x.toFixed(1);
        inputPosY.value = pos.y.toFixed(1);
        inputPosZ.value = pos.z.toFixed(1);
        inputScale.value = scale.toFixed(2);
        inputRotX.value = Math.round(rot.x);
        inputRotY.value = Math.round(rot.y);
        inputRotZ.value = Math.round(rot.z);

        if (!suppressCameraLookAt) {
            // Rotate camera to face the selected model
            camera.lookAt(pos);
            const euler = camera.getEulerAngles();
            cameraYaw = euler.y;
            cameraPitch = euler.x;
        }
    }
}

function toggleModelVisibility(modelId) {
    const model = loadedModels.find(m => m.id === modelId);
    if (model) {
        model.visible = !model.visible;
        model.entity.enabled = model.visible;
        
        const visBtn = document.getElementById(`vis-${modelId}`);
        if (visBtn) {
            if (model.visible) {
                visBtn.classList.add('active');
            } else {
                visBtn.classList.remove('active');
            }
        }
        updateStats();
    }
}

function deleteModel(modelId) {
    const index = loadedModels.findIndex(m => m.id === modelId);
    if (index !== -1) {
        const model = loadedModels[index];
        
        // Remove from hierarchy and clean up resources
        model.entity.destroy();
        app.assets.remove(model.asset);
        
        // Revoke Blob URL to free memory
        if (model.asset.file && model.asset.file.url) {
            URL.revokeObjectURL(model.asset.file.url);
        }

        loadedModels.splice(index, 1);
        
        // Remove from UI list
        const item = document.getElementById(`item-${modelId}`);
        if (item) {
            item.remove();
        }

        // If no models left, restore placeholder
        if (loadedModels.length === 0) {
            modelsContainer.innerHTML = '<div class="empty-list-text">No models loaded yet. Upload some above!</div>';
            activeControls.style.display = 'none';
            activeModelId = null;
            camera.setPosition(0, 1.5, 5);
            cameraYaw = 0;
            cameraPitch = 0;
            updateCameraRotation();
        } else if (activeModelId === modelId) {
            // Select the first remaining model
            selectModel(loadedModels[0].id);
        }
        
        updateStats();
    }
}

function updateStats() {
    const activeCount = loadedModels.filter(m => m.visible).length;
    statsCountLabel.textContent = `${activeCount} / ${loadedModels.length}`;
}

function updateCameraStats() {
    if (cameraPosStat) {
        const pos = camera.getPosition();
        cameraPosStat.textContent = `X: ${pos.x.toFixed(2)}, Y: ${pos.y.toFixed(2)}, Z: ${pos.z.toFixed(2)}`;
    }
    if (cameraRotStat) {
        cameraRotStat.textContent = `Pitch: ${Math.round(cameraPitch)}°, Yaw: ${Math.round(cameraYaw)}°`;
    }
    if (cameraZoomStat) {
        cameraZoomStat.textContent = `${Math.round(camera.camera.fov)}°`;
    }
}

// --- Transform Sliders Inputs ---
function updateActiveModelTransform() {
    if (!activeModelId) return;
    const model = loadedModels.find(m => m.id === activeModelId);
    if (!model) return;

    const px = parseFloat(controlPosX.value);
    const py = parseFloat(controlPosY.value);
    const pz = parseFloat(controlPosZ.value);
    const s = parseFloat(controlScale.value);
    const rx = parseFloat(controlRotX.value);
    const ry = parseFloat(controlRotY.value);
    const rz = parseFloat(controlRotZ.value);

    // Apply transforms to entity
    model.entity.setPosition(px, py, pz);
    model.entity.setLocalScale(s, s, s);
    model.entity.setEulerAngles(rx, ry, rz);

    // Update value inputs
    inputPosX.value = px.toFixed(1);
    inputPosY.value = py.toFixed(1);
    inputPosZ.value = pz.toFixed(1);
    inputScale.value = s.toFixed(2);
    inputRotX.value = Math.round(rx);
    inputRotY.value = Math.round(ry);
    inputRotZ.value = Math.round(rz);
}

// Bind numeric input events for model transform (bidirectional entry)
function handleModelTransformInput() {
    if (!activeModelId) return;
    const model = loadedModels.find(m => m.id === activeModelId);
    if (!model) return;

    // Parse values, clamping Scale and modulo-ing Rotation to 360 safely
    const px = parseFloat(inputPosX.value) || 0;
    const py = parseFloat(inputPosY.value) || 0;
    const pz = parseFloat(inputPosZ.value) || 0;
    const s = Math.min(5, Math.max(0.1, parseFloat(inputScale.value) || 1.0));
    const rx = (parseFloat(inputRotX.value) || 0) % 360;
    const ry = (parseFloat(inputRotY.value) || 0) % 360;
    const rz = (parseFloat(inputRotZ.value) || 0) % 360;

    // Apply to sliders
    controlPosX.value = px;
    controlPosY.value = py;
    controlPosZ.value = pz;
    controlScale.value = s;
    controlRotX.value = rx;
    controlRotY.value = ry;
    controlRotZ.value = rz;

    // Apply to entity
    model.entity.setPosition(px, py, pz);
    model.entity.setLocalScale(s, s, s);
    model.entity.setEulerAngles(rx, ry, rz);
}

// Attach slider listeners
controlPosX.addEventListener('input', updateActiveModelTransform);
controlPosY.addEventListener('input', updateActiveModelTransform);
controlPosZ.addEventListener('input', updateActiveModelTransform);
controlScale.addEventListener('input', updateActiveModelTransform);
controlRotX.addEventListener('input', updateActiveModelTransform);
controlRotY.addEventListener('input', updateActiveModelTransform);
controlRotZ.addEventListener('input', updateActiveModelTransform);

// Attach numeric input box listeners
if (inputPosX) {
    [inputPosX, inputPosY, inputPosZ, inputScale, inputRotX, inputRotY, inputRotZ].forEach((input) => {
        input.addEventListener('input', handleModelTransformInput);
    });
}

// --- Screen Recording (MediaStream Capture) ---
const recordBtn = document.getElementById('record-btn');
const recordBtnText = document.getElementById('record-btn-text');

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

recordBtn.addEventListener('click', () => {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
});

function startRecording() {
    recordedChunks = [];
    
    // Capture canvas stream at 30 FPS
    const stream = canvas.captureStream(30);
    
    let options = { mimeType: 'video/webm;codecs=vp9' };
    if (MediaRecorder.isTypeSupported('video/mp4')) {
        options = { mimeType: 'video/mp4' };
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
        options = { mimeType: 'video/webm;codecs=h264' };
    } else if (MediaRecorder.isTypeSupported('video/webm')) {
        options = { mimeType: 'video/webm' };
    }

    try {
        mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
        console.error('Failed to initialize MediaRecorder with options:', e);
        mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'video/webm';
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `splat-recording-${Date.now()}.${extension}`;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    };

    mediaRecorder.start();
    isRecording = true;
    recordBtn.classList.add('recording');
    recordBtnText.textContent = 'Stop Recording';
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.classList.remove('recording');
        recordBtnText.textContent = 'Start Recording';
    }
}

// --- Important Camera Shots (Waypoints) Management ---
const captureShotBtn = document.getElementById('capture-shot-btn');
const shotsContainer = document.getElementById('shots-container');

// Load stored shots or start empty
let cameraShots = [];
try {
    const savedShots = localStorage.getItem('splat_camera_shots');
    if (savedShots) {
        // Parse and reconstruct pc.Vec3 objects
        const parsed = JSON.parse(savedShots);
        cameraShots = parsed.map(s => ({
            id: s.id,
            name: s.name,
            position: new pc.Vec3(s.position.x, s.position.y, s.position.z),
            pitch: s.pitch,
            yaw: s.yaw,
            fov: s.fov ?? 45,
            stopDuration: s.stopDuration ?? 0,
            modelTransform: s.modelTransform ?? null
        }));
    }
} catch (e) {
    console.error('Failed to load saved camera shots:', e);
}

function saveShotsToStorage() {
    try {
        // Serialize shots nicely (convert pc.Vec3 to plain objects)
        const serialized = cameraShots.map(s => ({
            id: s.id,
            name: s.name,
            position: { x: s.position.x, y: s.position.y, z: s.position.z },
            pitch: s.pitch,
            yaw: s.yaw,
            fov: s.fov ?? 45,
            stopDuration: s.stopDuration ?? 0,
            modelTransform: s.modelTransform ?? null
        }));
        localStorage.setItem('splat_camera_shots', JSON.stringify(serialized));
    } catch (e) {
        console.error('Failed to save camera shots:', e);
    }
}

function renderShotsList() {
    if (cameraShots.length === 0) {
        shotsContainer.innerHTML = '<div class="empty-list-text">No shots captured yet. Press the button above to bookmark your current view!</div>';
        return;
    }

    shotsContainer.innerHTML = '';
    cameraShots.forEach((shot, index) => {
        const item = document.createElement('div');
        item.className = 'shot-item';
        item.id = `shot-${shot.id}`;
        item.draggable = true;

        const posText = `${shot.position.x.toFixed(1)}, ${shot.position.y.toFixed(1)}, ${shot.position.z.toFixed(1)}`;
        
        item.innerHTML = `
            <div class="shot-item-header">
                <span class="shot-name" id="shot-name-${shot.id}">${shot.name}</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="shot-coords" title="Position X,Y,Z">${posText}</span>
                    <label style="font-size: 0.7rem; color: #9ca3af; display: flex; align-items: center; gap: 4px;">
                        Stop: <input type="number" class="shot-stop-input" id="shot-stop-${shot.id}" value="${shot.stopDuration ?? 0}" min="0" max="60" step="0.5" style="width: 34px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 4px; padding: 1px 2px; font-size: 0.7rem; text-align: center;" draggable="false">s
                    </label>
                </div>
            </div>
            <div class="shot-actions">
                <button type="button" class="shot-btn warp" id="warp-shot-${shot.id}" draggable="false">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    Warp To
                </button>
                <button type="button" class="shot-btn" id="rename-shot-${shot.id}" draggable="false">
                    Rename
                </button>
                <button type="button" class="shot-btn" id="adjust-shot-${shot.id}" title="Update waypoint to current camera perspective" draggable="false">
                    Adjust
                </button>
                <button type="button" class="shot-btn delete" id="delete-shot-${shot.id}" draggable="false">
                    Delete
                </button>
            </div>
        `;

        shotsContainer.appendChild(item);

        // Drag & Drop Sorting Events
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', index);
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const targetIndex = index;
            
            if (draggedIndex !== targetIndex && !isNaN(draggedIndex)) {
                const [draggedShot] = cameraShots.splice(draggedIndex, 1);
                cameraShots.splice(targetIndex, 0, draggedShot);
                saveShotsToStorage();
                renderShotsList();
            }
        });

        // Bind Button Actions
        const warpBtn = document.getElementById(`warp-shot-${shot.id}`);
        warpBtn.addEventListener('click', () => {
            startWarpTo(shot.position, shot.pitch, shot.yaw, shot.modelTransform, shot.fov ?? 45);
        });

        const stopInput = document.getElementById(`shot-stop-${shot.id}`);
        stopInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            shot.stopDuration = isNaN(val) ? 0 : Math.max(0, val);
            saveShotsToStorage();
        });

        const renameBtn = document.getElementById(`rename-shot-${shot.id}`);
        renameBtn.addEventListener('click', () => {
            const newName = prompt('Rename Shot:', shot.name);
            if (newName !== null) {
                const trimmed = newName.trim();
                shot.name = trimmed || `Shot ${shot.id}`;
                saveShotsToStorage();
                renderShotsList();
            }
        });

        const adjustBtn = document.getElementById(`adjust-shot-${shot.id}`);
        adjustBtn.addEventListener('click', () => {
            shot.position.copy(camera.getPosition());
            shot.pitch = cameraPitch;
            shot.yaw = cameraYaw;
            shot.fov = camera.camera.fov;

            const activeModel = loadedModels.find(m => m.id === activeModelId);
            shot.modelTransform = activeModel ? {
                id: activeModelId,
                name: activeModel.name,
                position: { x: activeModel.entity.getPosition().x, y: activeModel.entity.getPosition().y, z: activeModel.entity.getPosition().z },
                rotation: { x: activeModel.entity.getEulerAngles().x, y: activeModel.entity.getEulerAngles().y, z: activeModel.entity.getEulerAngles().z },
                scale: activeModel.entity.getLocalScale().x
            } : null;

            saveShotsToStorage();
            renderShotsList();
        });

        const deleteBtn = document.getElementById(`delete-shot-${shot.id}`);
        deleteBtn.addEventListener('click', () => {
            const idx = cameraShots.findIndex(s => s.id === shot.id);
            if (idx !== -1) {
                cameraShots.splice(idx, 1);
                saveShotsToStorage();
                renderShotsList();
            }
        });
    });
}

captureShotBtn.addEventListener('click', () => {
    const nextId = cameraShots.length > 0 ? Math.max(...cameraShots.map(s => s.id)) + 1 : 1;
    const position = new pc.Vec3();
    position.copy(camera.getPosition());

    const activeModel = loadedModels.find(m => m.id === activeModelId);
    const modelTransform = activeModel ? {
        id: activeModelId,
        name: activeModel.name,
        position: { x: activeModel.entity.getPosition().x, y: activeModel.entity.getPosition().y, z: activeModel.entity.getPosition().z },
        rotation: { x: activeModel.entity.getEulerAngles().x, y: activeModel.entity.getEulerAngles().y, z: activeModel.entity.getEulerAngles().z },
        scale: activeModel.entity.getLocalScale().x
    } : null;

    const newShot = {
        id: nextId,
        name: `Shot ${nextId}`,
        position: position,
        pitch: cameraPitch,
        yaw: cameraYaw,
        fov: camera.camera.fov,
        stopDuration: 0,
        modelTransform: modelTransform
    };

    cameraShots.push(newShot);
    saveShotsToStorage();
    renderShotsList();
});

function startWarpTo(position, pitch, yaw, targetModelTransform = null, targetFov = 45) {
    warpStartPos.copy(camera.getPosition());
    warpEndPos.copy(position);
    warpStartPitch = cameraPitch;
    warpEndPitch = pitch;
    warpStartYaw = cameraYaw;
    warpStartFov = camera.camera.fov;
    warpEndFov = targetFov;

    // Adjust yaw difference to make sure we rotate the shortest way around the circle
    let yawDiff = yaw - cameraYaw;
    while (yawDiff < -180) yawDiff += 360;
    while (yawDiff > 180) yawDiff -= 360;
    warpEndYaw = cameraYaw + yawDiff;

    // Model warp setup
    warpModelEntity = null;
    if (targetModelTransform) {
        const model = loadedModels.find(m => m.name === targetModelTransform.name) || loadedModels.find(m => m.id === targetModelTransform.id);
        if (model) {
            // Activate model without resetting camera orientation
            selectModel(model.id, true);

            warpModelEntity = model.entity;
            warpStartModelPos.copy(model.entity.getPosition());
            warpEndModelPos.set(targetModelTransform.position.x, targetModelTransform.position.y, targetModelTransform.position.z);

            const currentRot = model.entity.getEulerAngles();
            warpStartModelRot.copy(currentRot);

            // Shortest path interpolation for 3-axis rotation
            let rxDiff = targetModelTransform.rotation.x - currentRot.x;
            while (rxDiff < -180) rxDiff += 360;
            while (rxDiff > 180) rxDiff -= 360;

            let ryDiff = targetModelTransform.rotation.y - currentRot.y;
            while (ryDiff < -180) ryDiff += 360;
            while (ryDiff > 180) ryDiff -= 360;

            let rzDiff = targetModelTransform.rotation.z - currentRot.z;
            while (rzDiff < -180) rzDiff += 360;
            while (rzDiff > 180) rzDiff -= 360;

            warpEndModelRot.set(currentRot.x + rxDiff, currentRot.y + ryDiff, currentRot.z + rzDiff);

            warpStartModelScale = model.entity.getLocalScale().x;
            warpEndModelScale = targetModelTransform.scale;
        }
    }

    warpTimer = 0;
    isWarping = true;
}

// --- Camera Path Playback Actions ---
const playPathBtn = document.getElementById('play-path-btn');

playPathBtn.addEventListener('click', () => {
    if (!isPlayingPath) {
        startPathPlayback();
    } else {
        stopPathPlayback();
    }
});

function startPathPlayback() {
    if (cameraShots.length < 2) {
        alert('Please capture or save at least 2 shots to play a camera path!');
        return;
    }
    
    // Stop any active single warp
    isWarping = false;

    // Check "Record Path Playback" checkbox
    const withRecordCheckbox = document.getElementById('path-with-record');
    if (withRecordCheckbox && withRecordCheckbox.checked && !isRecording) {
        startRecording();
    }

    // Transition smoothly to the first shot (Shot 0) from current view
    startWarpTo(cameraShots[0].position, cameraShots[0].pitch, cameraShots[0].yaw, cameraShots[0].modelTransform);
    
    // Set warp complete callback to trigger path playback from Shot 0!
    warpCallback = () => {
        isPlayingPath = true;
        currentPathSegment = 0;
        pathSegmentTimer = 0;
        
        const firstShotWait = cameraShots[0].stopDuration ?? 0;
        if (firstShotWait > 0) {
            pathState = 'stopped';
            pathWaitTimer = 0;
            currentWaitDuration = firstShotWait;
        } else {
            pathState = 'moving';
            pathWaitTimer = 0;
            currentWaitDuration = 0;
        }
        updatePlayPathButtonUI();
    };

    updatePlayPathButtonUI();
}

function stopPathPlayback() {
    isPlayingPath = false;
    updatePlayPathButtonUI();

    // Automatically stop and download recording if active
    if (isRecording) {
        stopRecording();
    }
}

function updatePlayPathButtonUI() {
    const playPathBtnText = document.getElementById('play-path-btn-text');
    if (isPlayingPath) {
        playPathBtn.classList.add('playing');
        playPathBtnText.textContent = 'Stop Camera Path';
    } else {
        playPathBtn.classList.remove('playing');
        playPathBtnText.textContent = 'Play Camera Path';
    }
}

// --- Camera Shots JSON Import/Export Actions ---
const exportShotsBtn = document.getElementById('export-shots-btn');
const importJsonInput = document.getElementById('import-json-input');

exportShotsBtn.addEventListener('click', () => {
    exportShotsToJSON();
});

importJsonInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (!data || !Array.isArray(data.shots)) {
                throw new Error('Invalid format: \'shots\' array missing.');
            }

            // Restore shots and reconstruct pc.Vec3 objects with full schema validation
            cameraShots = data.shots.map((s) => {
                if (!s.position || typeof s.position.x !== 'number' || typeof s.position.y !== 'number' || typeof s.position.z !== 'number') {
                    throw new Error('Invalid shot position coordinates.');
                }
                return {
                    id: s.id ?? Math.floor(Math.random() * 100000),
                    name: s.name ?? 'Shot',
                    position: new pc.Vec3(s.position.x, s.position.y, s.position.z),
                    pitch: s.pitch ?? 0,
                    yaw: s.yaw ?? 0,
                    stopDuration: s.stopDuration ?? 0,
                    modelTransform: s.modelTransform ?? null
                };
            });

            saveShotsToStorage();
            renderShotsList();

            const importedModelName = data.modelName ?? 'Unknown Model';
            alert(`Successfully imported ${cameraShots.length} shots configured for model "${importedModelName}"!`);
        } catch (err) {
            console.error('Failed to parse JSON file:', err);
            alert(`Import failed: ${err.message}`);
        }
        // Clear input value so same file can be selected again
        importJsonInput.value = '';
    };
    reader.readAsText(file);
});

function exportShotsToJSON() {
    if (cameraShots.length === 0) {
        alert('No shots to export! Create some shots first.');
        return;
    }

    // Identify active model filename
    const activeModel = loadedModels.find(m => m.id === activeModelId);
    const modelName = activeModel ? activeModel.name : 'No Active Model';

    const data = {
        modelName: modelName,
        shots: cameraShots.map(s => ({
            id: s.id,
            name: s.name,
            position: { x: s.position.x, y: s.position.y, z: s.position.z },
            pitch: s.pitch,
            yaw: s.yaw,
            stopDuration: s.stopDuration ?? 0,
            modelTransform: s.modelTransform ?? null
        }))
    };

    const jsonString = JSON.stringify(data, null, 4);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const safeModelName = modelName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${safeModelName}_camera_shots.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// Initial render
renderShotsList();