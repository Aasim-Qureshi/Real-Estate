import asyncio
import sys
import json
import traceback
import platform
from login import startLogin, submitOtp
from browser import closeBrowser, get_browser
from formFiller import runFormFill

if platform.system().lower() == "windows":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Task control management
_task_controls = {}
_active_tasks = {}  # Track running tasks

class TaskStoppedException(Exception):
    """Raised when task is stopped"""
    pass

def create_control_state(task_id, batch_id=None):
    """Create a new control state for a task"""
    _task_controls[task_id] = {
        "paused": False,
        "stopped": False,
        "batch_id": batch_id
    }
    return _task_controls[task_id]

def get_control_state(task_id):
    """Get control state for a task"""
    return _task_controls.get(task_id)

def cleanup_control_state(task_id):
    """Remove control state when task completes"""
    if task_id in _task_controls:
        del _task_controls[task_id]
    if task_id in _active_tasks:
        del _active_tasks[task_id]

async def check_control(state):
    """Check if we should pause or stop"""
    if state.get("stopped"):
        raise TaskStoppedException("Task was stopped by user")
    
    while state.get("paused"):
        await asyncio.sleep(0.5)
        if state.get("stopped"):
            raise TaskStoppedException("Task was stopped by user")

async def process_batch_task(cmd):
    """Process batch in background task"""
    try:
        batch_id = cmd.get("batchId")
        report_ids = cmd.get("reportIds", [])
        socket_mode = cmd.get("socketMode", False)
        
        print(f"[PY] Starting batch processing: {batch_id} with {len(report_ids)} reports", file=sys.stderr)
        
        # Get browser instance
        browser = await get_browser()
        
        # Create control state for this task
        control_state = create_control_state(batch_id, batch_id)
        
        # Emit start progress
        if socket_mode:
            progress_data = {
                "type": "PROGRESS",
                "batchId": batch_id,
                "status": "STARTED",
                "message": f"Starting processing for batch {batch_id}",
                "current": 0,
                "total": len(report_ids),
                "percentage": 0,
                "timestamp": asyncio.get_event_loop().time()
            }
            print(json.dumps(progress_data), flush=True)
        
        # Process the batch
        result = await runFormFill(browser, batch_id, control_state)
        
        # Add batchId to result
        result["batchId"] = batch_id
        
        # Emit completion progress
        if socket_mode and result.get("status") == "SUCCESS":
            progress_data = {
                "type": "PROGRESS",
                "batchId": batch_id,
                "status": "COMPLETED",
                "message": f"Batch {batch_id} processed successfully",
                "current": len(report_ids),
                "total": len(report_ids),
                "percentage": 100,
                "timestamp": asyncio.get_event_loop().time(),
                "failed_records": result.get("failed_records", 0)
            }
            print(json.dumps(progress_data), flush=True)
        
        result["commandId"] = cmd.get("commandId")
        print(json.dumps(result), flush=True)
        
    except TaskStoppedException as e:
        result = {
            "status": "STOPPED",
            "message": str(e),
            "batchId": cmd.get("batchId"),
            "commandId": cmd.get("commandId")
        }
        print(json.dumps(result), flush=True)
    except Exception as e:
        tb = traceback.format_exc()
        result = {
            "status": "FAILED", 
            "error": str(e), 
            "traceback": tb,
            "batchId": cmd.get("batchId"),
            "commandId": cmd.get("commandId")
        }
        print(json.dumps(result), flush=True)
    finally:
        cleanup_control_state(cmd.get("batchId"))

async def handle_process_batch_command(cmd):
    """Handle batch processing command - starts task in background"""
    batch_id = cmd.get("batchId")
    
    # Create and store the task
    task = asyncio.create_task(process_batch_task(cmd))
    _active_tasks[batch_id] = task
    
    # Send immediate acknowledgment
    ack_response = {
        "status": "ACKNOWLEDGED",
        "message": f"Batch {batch_id} processing started",
        "batchId": batch_id,
        "commandId": cmd.get("commandId")
    }
    print(json.dumps(ack_response), flush=True)

async def handle_control_command(cmd):
    """Handle control commands (pause, resume, stop)"""
    try:
        action = cmd.get("action")
        batch_id = cmd.get("batchId")
        
        print(f"[PY] Control command: {action} for batch {batch_id}", file=sys.stderr)
        
        # Find control state by batch_id
        target_state = None
        target_task_id = None
        
        for task_id, state in _task_controls.items():
            if state.get("batch_id") == batch_id:
                target_state = state
                target_task_id = task_id
                break
        
        if not target_state:
            result = {
                "status": "FAILED", 
                "error": f"No active task found for batch {batch_id}",
                "commandId": cmd.get("commandId")
            }
            print(json.dumps(result), flush=True)
            return
        
        if action == "pause":
            target_state["paused"] = True
            result = {
                "status": "PAUSED", 
                "message": "Task paused",
                "batchId": batch_id,
                "commandId": cmd.get("commandId")
            }
            
        elif action == "resume":
            target_state["paused"] = False
            result = {
                "status": "RESUMED", 
                "message": "Task resumed",
                "batchId": batch_id,
                "commandId": cmd.get("commandId")
            }
            
        elif action == "stop":
            target_state["stopped"] = True
            target_state["paused"] = False  # Unpause if paused
            
            # Close all tabs except the main page
            try:
                browser = await get_browser()
                pages = browser.tabs
                if len(pages) > 1:
                    for page in pages[1:]:
                        try:
                            await page.close()
                        except Exception as e:
                            print(f"Warning: Failed to close tab: {e}", file=sys.stderr)
                    print(f"Closed {len(pages) - 1} additional tabs", file=sys.stderr)
            except Exception as e:
                print(f"Warning: Error closing tabs: {e}", file=sys.stderr)
            
            result = {
                "status": "STOPPED", 
                "message": "Task stopped",
                "batchId": batch_id,
                "commandId": cmd.get("commandId")
            }
        
        print(json.dumps(result), flush=True)
        
    except Exception as e:
        tb = traceback.format_exc()
        result = {
            "status": "FAILED", 
            "error": str(e), 
            "traceback": tb,
            "commandId": cmd.get("commandId")
        }
        print(json.dumps(result), flush=True)

async def command_handler():
    """Main command handler for the worker"""
    loop = asyncio.get_running_loop()
    
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        
        try:
            cmd = json.loads(line.strip())
            action = cmd.get("action")
            
            print(f"[PY] Received action: {action}", file=sys.stderr)
            
            if action == "processTaqeemBatch":
                # Start task in background, don't await
                await handle_process_batch_command(cmd)
                
            elif action in ["pause", "resume", "stop"]:
                await handle_control_command(cmd)
                
            elif action == "login":
                browser = await get_browser(force_new=True)
                page = await browser.get(
                    "https://sso.taqeem.gov.sa/realms/REL_TAQEEM/protocol/openid-connect/auth"
                    "?client_id=cli-qima-valuers&redirect_uri=https%3A%2F%2Fqima.taqeem.sa%2Fkeycloak%2Flogin%2Fcallback"
                    "&scope=openid&response_type=code"
                )
                result = await startLogin(page, cmd.get("email", ""), cmd.get("password", ""), cmd.get("recordId"))
                result["commandId"] = cmd.get("commandId")
                print(json.dumps(result), flush=True)
                
            elif action == "otp":
                browser = await get_browser()
                if not browser or not browser.main_tab:
                    result = {
                        "status": "FAILED", 
                        "error": "No active browser session. Please login first.",
                        "commandId": cmd.get("commandId")
                    }
                    print(json.dumps(result), flush=True)
                    continue
                page = browser.main_tab
                result = await submitOtp(page, cmd.get("otp", ""), cmd.get("recordId"))
                result["commandId"] = cmd.get("commandId")
                print(json.dumps(result), flush=True)
                
            elif action == "close":
                await closeBrowser()
                result = {
                    "status": "SUCCESS",
                    "message": "Browser closed successfully",
                    "commandId": cmd.get("commandId")
                }
                print(json.dumps(result), flush=True)
                break
                
            elif action == "ping":
                result = {
                    "status": "SUCCESS",
                    "message": "pong",
                    "commandId": cmd.get("commandId")
                }
                print(json.dumps(result), flush=True)
                
            else:
                result = {
                    "status": "FAILED", 
                    "error": f"Unknown action: {action}",
                    "supported_actions": ["processTaqeemBatch", "login", "otp", "close", "ping", "pause", "resume", "stop"],
                    "commandId": cmd.get("commandId")
                }
                print(json.dumps(result), flush=True)
                
        except json.JSONDecodeError as e:
            error_response = {
                "status": "FAILED",
                "error": f"Invalid JSON: {str(e)}",
                "received": line.strip()
            }
            print(json.dumps(error_response), flush=True)
        except Exception as e:
            tb = traceback.format_exc()
            error_response = {
                "status": "FAILED",
                "error": f"Command handler error: {str(e)}",
                "traceback": tb
            }
            print(json.dumps(error_response), flush=True)

async def main():
    try:
        await command_handler()
    except Exception as e:
        print(json.dumps({"status": "FATAL", "error": str(e)}), flush=True)
    finally:
        await closeBrowser()

if __name__ == "__main__":
    asyncio.run(main())