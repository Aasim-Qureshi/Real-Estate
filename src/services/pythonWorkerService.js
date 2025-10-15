const { spawn } = require('child_process');
const path = require('path');

class PythonWorkerService {
    constructor() {
        this.worker = null;
        this.stdoutBuffer = '';
        this.pendingCommands = new Map();
        this.commandId = 0;
        this.isWorkerReady = false;
    }

    startWorker() {
        if (this.worker && !this.worker.killed) {
            console.log('[PY] Worker already running');
            return this.worker;
        }

        const isWindows = process.platform === 'win32';
        const pythonExecutable = isWindows
            ? path.join(__dirname, '../../.venv/Scripts/python.exe')
            : path.join(__dirname, '../../.venv/bin/python');

        const scriptPath = path.join(__dirname, '../scripts/estate/worker_taqeem.py');
        const scriptDir = path.dirname(scriptPath);

        console.log(`[PY] Starting worker: ${pythonExecutable} ${scriptPath}`);

        this.worker = spawn(pythonExecutable, [scriptPath], {
            cwd: scriptDir,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.stdoutBuffer = '';
        this.isWorkerReady = false;

        this.worker.stdout.on('data', (data) => {
            this.stdoutBuffer += data.toString();
            const lines = this.stdoutBuffer.split(/\r?\n/);
            this.stdoutBuffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                this.handleWorkerOutput(line);
            }
        });

        this.worker.stderr.on('data', (data) => {
            console.log(`[PY STDERR] ${data.toString().trim()}`);
        });

        this.worker.on('spawn', () => {
            console.log('[PY] Worker process spawned');
            this.isWorkerReady = true;
        });

        this.worker.on('close', (code, signal) => {
            console.log(`[PY] Worker exited (code=${code}, signal=${signal})`);
            this.isWorkerReady = false;
            this.worker = null;

            // Reject all pending commands
            this.pendingCommands.forEach((handler) => {
                handler.reject(new Error(`Worker exited with code ${code}`));
            });
            this.pendingCommands.clear();
        });

        this.worker.on('error', (error) => {
            console.error('[PY] Worker error:', error);
            this.isWorkerReady = false;
        });

        return this.worker;
    }

    handleWorkerOutput(line) {
        try {
            const response = JSON.parse(line);
            console.log('[PY] Response:', response);

            // Handle progress updates
            if (response.type === 'PROGRESS') {
                // Emit to sockets
                const io = require('./socketService').getIO();
                if (io && response.batchId) {
                    io.to(`batch_${response.batchId}`).emit('processing_progress', response);
                    
                    // Handle completion/stopped status from progress updates
                    if (response.status === 'COMPLETED') {
                        io.to(`batch_${response.batchId}`).emit('processing_complete', {
                            batchId: response.batchId,
                            status: 'COMPLETED',
                            message: response.message,
                            failedRecords: response.failed_records || 0,
                            timestamp: new Date().toISOString()
                        });
                        
                        // Clean up session
                        const socketService = require('./socketService');
                        socketService.activeSessions.delete(response.batchId);
                        console.log(`[PROCESSING COMPLETE] Batch ${response.batchId} completed via progress`);
                    }
                }
                return;
            }

            // Handle command responses (including final SUCCESS/STOPPED/FAILED)
            if (response.commandId !== undefined) {
                const handler = this.pendingCommands.get(response.commandId);
                if (handler) {
                    handler.resolve(response);
                    this.pendingCommands.delete(response.commandId);
                    
                    // Also handle final status for batch commands
                    if (response.batchId && (response.status === 'SUCCESS' || response.status === 'STOPPED' || response.status === 'FAILED')) {
                        const io = require('./socketService').getIO();
                        const socketService = require('./socketService');
                        
                        if (response.status === 'STOPPED') {
                            io.to(`batch_${response.batchId}`).emit('processing_stopped', {
                                batchId: response.batchId,
                                status: 'STOPPED',
                                message: response.message,
                                timestamp: new Date().toISOString()
                            });
                            socketService.activeSessions.delete(response.batchId);
                            console.log(`[PROCESSING STOPPED] Batch ${response.batchId} via command response`);
                        } else if (response.status === 'FAILED') {
                            io.to(`batch_${response.batchId}`).emit('processing_error', {
                                batchId: response.batchId,
                                status: 'FAILED',
                                error: response.error,
                                timestamp: new Date().toISOString()
                            });
                            socketService.activeSessions.delete(response.batchId);
                            console.log(`[PROCESSING FAILED] Batch ${response.batchId} via command response`);
                        }
                    }
                }
            }

        } catch (error) {
            console.error('[PY] Failed to parse worker output:', line, error);
        }
    }

    async sendCommand(command) {
        if (!this.worker || !this.isWorkerReady) {
            this.startWorker();
            // Wait a bit for worker to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const commandId = this.commandId++;
        const commandWithId = { ...command, commandId };

        return new Promise((resolve, reject) => {
            // Store handler without timeout
            this.pendingCommands.set(commandId, {
                resolve: (result) => {
                    resolve(result);
                },
                reject: (error) => {
                    reject(error);
                }
            });

            // Send command to worker
            try {
                this.worker.stdin.write(JSON.stringify(commandWithId) + '\n');
                console.log(`[PY] Sent command: ${command.action} (id: ${commandId})`);
            } catch (error) {
                this.pendingCommands.delete(commandId);
                reject(new Error(`Failed to send command to worker: ${error.message}`));
            }
        });
    }

    async ping() {
        return this.sendCommand({ action: 'ping' });
    }

    async hello() {
        return this.sendCommand({ action: 'hello' });
    }

    async simulateWork() {
        return this.sendCommand({ action: 'simulate_work' });
    }

    async login(email, password, recordId = null) {
        return this.sendCommand({
            action: 'login',
            email,
            password,
            recordId
        });
    }

    async submitOtp(otp, recordId = null) {
        return this.sendCommand({
            action: 'otp',
            otp,
            recordId
        });
    }

    async processTaqeemBatch(batchId, reportIds, socketMode = true) {
        return this.sendCommand({
            action: 'processTaqeemBatch',
            batchId,
            reportIds,
            socketMode
        });
    }

    async pauseProcessing(batchId) {
        return this.sendCommand({
            action: 'pause',
            batchId
        });
    }

    async resumeProcessing(batchId) {
        return this.sendCommand({
            action: 'resume',
            batchId
        });
    }

    async stopProcessing(batchId) {
        return this.sendCommand({
            action: 'stop',
            batchId
        });
    }

    async closeBrowser() {
        return this.sendCommand({
            action: 'close'
        });
    }

    async closeWorker() {
        if (!this.worker) return;

        try {
            await this.sendCommand({ action: 'close' });
        } catch (error) {
            console.log('[PY] Close command failed, forcing shutdown:', error.message);
        } finally {
            if (this.worker) {
                this.worker.kill('SIGTERM');
                this.worker = null;
                this.isWorkerReady = false;
            }
        }
    }

    isReady() {
        return this.isWorkerReady && this.worker && !this.worker.killed;
    }

    getStatus() {
        return {
            ready: this.isReady(),
            workerRunning: !!this.worker,
            pendingCommands: this.pendingCommands.size
        };
    }
}

module.exports = new PythonWorkerService();