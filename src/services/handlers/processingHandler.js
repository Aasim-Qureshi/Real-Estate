const pythonWorkerService = require('../pythonWorkerService');

module.exports = (socket, socketService) => {
  socket.on('start_taqeem_processing', async (data) => {
    const { batchId, reportIds, actionType = 'process' } = data;
    
    try {
      // Validate required fields
      if (!batchId) {
        throw new Error('batchId is required');
      }

      console.log(`[PROCESSING STARTED] Batch ${batchId}`);

      // Join the batch room so this socket receives updates
      socket.join(`batch_${batchId}`);
      
      // Store session
      socketService.activeSessions.set(batchId, {
        socket,
        batchId,
        reportIds,
        startedAt: new Date(),
        userId: socket.userId
      });

      // Emit start confirmation
      socket.emit('processing_started', {
        batchId,
        status: 'STARTED',
        totalReports: reportIds.length,
        timestamp: new Date().toISOString()
      });

      // Emit to batch room
      socketService.io.to(`batch_${batchId}`).emit('batch_status_update', {
        batchId,
        status: 'PROCESSING_STARTED',
        totalReports: reportIds.length,
        timestamp: new Date().toISOString()
      });

      console.log(`[PYTHON WORKER] Sending batch ${batchId} to Python worker for processing`);

      // Start Python worker processing (this now returns immediately with ACKNOWLEDGED)
      const response = await pythonWorkerService.processTaqeemBatch(batchId, reportIds, true);
      
      // Check if the task was acknowledged (started successfully)
      if (response.status === 'ACKNOWLEDGED') {
        console.log(`[PROCESSING ACKNOWLEDGED] Batch ${batchId} processing started in background`);
        // Don't send completion here - it will come via progress updates
        // The actual completion/failure will be sent through the PROGRESS messages
      } else if (response.status === 'FAILED') {
        // Only handle immediate failures (before task could start)
        throw new Error(response.error || 'Failed to start processing');
      }

    } catch (error) {
      console.error(`[SOCKET ERROR] start_taqeem_processing:`, error);
      socket.emit('processing_error', {
        batchId,
        status: 'FAILED',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      socketService.activeSessions.delete(batchId);
    }
  });

  socket.on('pause_processing', async (data) => {
    const { batchId } = data;
    
    try {
      console.log(`[PAUSE REQUEST] Batch ${batchId}`);
      const response = await pythonWorkerService.pauseProcessing(batchId);
      
      if (response.status === 'PAUSED') {
        socketService.io.to(`batch_${batchId}`).emit('processing_paused', {
          batchId,
          status: 'PAUSED',
          timestamp: new Date().toISOString()
        });
        console.log(`[PROCESSING PAUSED] Batch ${batchId}`);
      } else if (response.status === 'FAILED') {
        throw new Error(response.error || 'Failed to pause processing');
      }
    } catch (error) {
      console.error(`[SOCKET ERROR] pause_processing:`, error);
      socket.emit('processing_error', {
        batchId,
        status: 'FAILED',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('resume_processing', async (data) => {
    const { batchId } = data;
    
    try {
      console.log(`[RESUME REQUEST] Batch ${batchId}`);
      const response = await pythonWorkerService.resumeProcessing(batchId);
      
      if (response.status === 'RESUMED') {
        socketService.io.to(`batch_${batchId}`).emit('processing_resumed', {
          batchId,
          status: 'RESUMED',
          timestamp: new Date().toISOString()
        });
        console.log(`[PROCESSING RESUMED] Batch ${batchId}`);
      } else if (response.status === 'FAILED') {
        throw new Error(response.error || 'Failed to resume processing');
      }
    } catch (error) {
      console.error(`[SOCKET ERROR] resume_processing:`, error);
      socket.emit('processing_error', {
        batchId,
        status: 'FAILED',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('stop_processing', async (data) => {
    const { batchId } = data;
    
    try {
      console.log(`[STOP REQUEST] Batch ${batchId}`);
      const response = await pythonWorkerService.stopProcessing(batchId);
      
      if (response.status === 'STOPPED') {
        socketService.io.to(`batch_${batchId}`).emit('processing_stopped', {
          batchId,
          status: 'STOPPED',
          timestamp: new Date().toISOString()
        });
        
        // Clean up session
        socketService.activeSessions.delete(batchId);
        console.log(`[PROCESSING STOPPED] Batch ${batchId}`);
      } else if (response.status === 'FAILED') {
        throw new Error(response.error || 'Failed to stop processing');
      }
    } catch (error) {
      console.error(`[SOCKET ERROR] stop_processing:`, error);
      socket.emit('processing_error', {
        batchId,
        status: 'FAILED',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
};