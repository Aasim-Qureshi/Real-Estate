import asyncio
import time
import traceback
import json
import sys
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from formSteps import form_steps

MONGO_URI="mongodb+srv://test:JUL3OvyCSLVjSixj@assetval.pu3bqyr.mongodb.net/projectForever"
client = AsyncIOMotorClient(MONGO_URI)
db = client["projectForever"]

def emit_progress(status, message, batch_id, record_id=None, **kwargs):
    """Emit progress updates that Node.js will forward to Socket.IO clients"""
    progress_data = {
        "type": "PROGRESS",
        "status": status,
        "message": message,
        "batchId": batch_id,
        "recordId": record_id,
        "timestamp": time.time(),
        **kwargs
    }
    
    print(json.dumps(progress_data), flush=True)

async def wait_for_element(page, selector, timeout=30, check_interval=0.5):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            element = await page.query_selector(selector)
            if element:
                return element
        except Exception:
            pass
        await asyncio.sleep(check_interval)
    return None

_location_cache = {}

async def set_location(page, country_name, region_name, city_name):
    try:
        import re, unicodedata

        cache_key = f"{country_name}|{region_name}|{city_name}"

        def normalize_text(text: str) -> str:
            if not text:
                return ""
            text = unicodedata.normalize("NFKC", text)
            text = re.sub(r"\s+", " ", text)
            return text.strip()

        async def wait_for_options(selector, min_options=2, timeout=10):
            for _ in range(timeout * 2):
                el = await wait_for_element(page, selector, timeout=1)
                if el and getattr(el, "children", None) and len(el.children) >= min_options:
                    return el
                await asyncio.sleep(0.5)
            return None

        async def get_location_code(name, selector):
            if not name:
                return None
            el = await wait_for_options(selector)
            if not el:
                return None
            for opt in el.children:
                text = normalize_text(opt.text)
                if normalize_text(name).lower() in text.lower():
                    return opt.attrs.get("value")
            return None

        async def set_field(selector, value):
            if not value:
                return
            args = json.dumps({"selector": selector, "value": value})
            await page.evaluate(f"""
                (function() {{
                    const args = {args};
                    if (window.$) {{
                        window.$(args.selector).val(args.value).trigger("change");
                    }} else {{
                        const el = document.querySelector(args.selector);
                        if (!el) return;
                        if (el.value !== args.value) {{
                            el.value = args.value;
                            el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                            el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        }}
                    }}
                }})();
            """)

        region_code, city_code = _location_cache.get(cache_key, (None, None))

        if not region_code:
            region_code = await get_location_code(region_name, "#region")
        if not city_code:
            city_code = await get_location_code(city_name, "#city")

        if region_code or city_code:
            _location_cache[cache_key] = (region_code, city_code)

        await set_field("#country_id", "1")
        await asyncio.sleep(0.5)
        await set_field("#region", region_code)
        await asyncio.sleep(0.5)
        await set_field("#city", city_code)
        await asyncio.sleep(0.5)

        return True

    except Exception as e:
        print(f"Location injection failed: {e}", file=sys.stderr)
        return False

async def bulk_inject_inputs(page, record, field_map, field_types):
    jsdata = {}
    
    for key, selector in field_map.items():
        if key not in record:
            continue

        field_type = field_types.get(key, "text")
        value = str(record[key] or "").strip()

        if field_type == "date" and value:
            try:
                value = datetime.strptime(value, "%d-%m-%Y").strftime("%Y-%m-%d")
            except ValueError:
                try:
                    datetime.strptime(value, "%Y-%m-%d")
                except ValueError:
                    print(f"[WARNING] Invalid date format for {key}: {value}", file=sys.stderr)
                    continue

        jsdata[selector] = {"type": field_type, "value": value}

    js = f"""
    (function() {{
        const data = {json.dumps(jsdata)};
        let successCount = 0;
        let failCount = 0;
        const failures = [];
        
        for (const [selector, meta] of Object.entries(data)) {{
            const el = document.querySelector(selector);
            if (!el) {{
                failures.push({{selector, reason: 'Element not found'}});
                failCount++;
                continue;
            }}

            try {{
                switch(meta.type) {{
                    case "checkbox":
                        el.checked = Boolean(meta.value);
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;

                    case "select":
                        let found = false;
                        for (const opt of el.options) {{
                            if (opt.value == meta.value || opt.text == meta.value) {{
                                el.value = opt.value;
                                found = true;
                                break;
                            }}
                        }}
                        if (!found && el.options.length) {{
                            el.selectedIndex = 0;
                        }}
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;

                    case "radio":
                        const labels = document.querySelectorAll('label.form-check-label');
                        let radioFound = false;
                        for (const lbl of labels) {{
                            if ((lbl.innerText || '').trim() === meta.value) {{
                                const radio = document.getElementById(lbl.getAttribute('for'));
                                if (radio) {{
                                    radio.checked = true;
                                    radio.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                    radioFound = true;
                                    break;
                                }}
                            }}
                        }}
                        break;

                    case "date":
                    case "text":
                    default:
                        el.value = meta.value ?? "";
                        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;
                }}
                successCount++;
            }} catch(err) {{
                failures.push({{selector, reason: err.message}});
                failCount++;
            }}
        }}
        
        return {{successCount, failCount, failures}};
    }})();
    """

    try:
        result = await page.evaluate(js)
        if isinstance(result, dict) and result.get('failures'):
            print(json.dumps({
                "type": "WARNING", 
                "message": f"Failed to inject fields: {result['failures']}"
            }), flush=True)
    except Exception as e:
        print(json.dumps({
            "type": "ERROR", 
            "message": f"JavaScript evaluation failed: {str(e)}"
        }), flush=True)

class ProgressTracker:
    """Track progress focusing only on main tab"""
    
    def __init__(self, total_records, num_tabs, total_steps=len(form_steps)):
        self.total_records = total_records
        self.num_tabs = num_tabs
        self.total_steps = total_steps
        
        # Weight steps by estimated time
        self.step_weights = {
            1: 0.15,  # Step 1: 15%
            2: 0.20,  # Step 2: 20%
            3: 0.25,  # Step 3: 25%
            4: 0.30,  # Step 4: 25%
            5: 0.10   # Step 5: 5% (save step)
        }
        
        # Normalize weights
        total_weight = sum(self.step_weights.values())
        if total_weight != 1.0:
            for step in self.step_weights:
                self.step_weights[step] /= total_weight
        
        self.completed_records = 0
        self.main_tab_progress = {}  # Track only main tab progress
    
    def get_overall_percentage(self, tab_id, current_step, record_index, total_in_tab, is_main_tab=False):
        """Calculate overall percentage - focus on main tab progress"""
        if not is_main_tab:
            # For non-main tabs, just return base progress
            return (self.completed_records / self.total_records) * 100
        
        # For main tab, calculate detailed progress
        base_percentage = (self.completed_records / self.total_records) * 100
        
        # Current record progress within current step
        step_progress = 0
        if current_step <= self.total_steps:
            step_weight = self.step_weights.get(current_step, 0.2)
            step_progress = (record_index / total_in_tab) * step_weight * 100
        
        # Add progress for completed steps
        current_step_progress = 0
        for step in range(1, current_step):
            current_step_progress += self.step_weights.get(step, 0.2) * 100
        
        total_percentage = base_percentage + current_step_progress + step_progress
        
        # Cap at 99% until truly complete
        return min(99.0, total_percentage)
    
    def record_completed(self):
        """Mark a record as completed"""
        self.completed_records += 1
    
    def update_main_tab_progress(self, step, record_index, total_in_tab):
        """Update progress for main tab only"""
        self.main_tab_progress = {
            'step': step,
            'record_index': record_index,
            'total_in_tab': total_in_tab,
            'percentage': self.get_overall_percentage(1, step, record_index, total_in_tab, is_main_tab=True)
        }

async def fill_form(page, record, field_map, field_types, is_last_step=False, retries=0, max_retries=2, skip_special_fields=False, control_state=None, batch_id=None, record_id=None, tab_id=None, progress_tracker=None, step_num=None):
    try:
        if control_state:
            from worker_taqeem import check_control
            await check_control(control_state)
        
        # PHASE 1: Handle asset_type FIRST
        if "asset_type" in field_map and "asset_type" in record:
            selector = field_map["asset_type"]
            value = str(record["asset_type"] or "")
            
            select_element = await wait_for_element(page, selector, timeout=10)
            if select_element:
                options = select_element.children
                for option in options:
                    option_attrs = option.attrs
                    option_value = option_attrs.get("value")
                    if option_value == value:
                        await option.select_option()
                        break
        
        # PHASE 2: Bulk inject standard fields
        bulk_field_map = {}
        bulk_field_types = {}
        
        for key, selector in field_map.items():
            field_type = field_types.get(key, "text")
            if field_type not in ["dynamic_select", "location", "file"]:
                bulk_field_map[key] = selector
                bulk_field_types[key] = field_type
        
        await bulk_inject_inputs(page, record, bulk_field_map, bulk_field_types)
        await asyncio.sleep(1)
        
        # PHASE 3: Handle special fields
        for key, selector in field_map.items():
            if key not in record:
                continue

            value = str(record[key] or "")
            field_type = field_types.get(key, "text")

            try:
                if field_type == "location":
                    country_name = record.get("country", "")
                    region_name = record.get("region", "")
                    city_name = record.get("city", "")
                    await set_location(page, country_name, region_name, city_name)
                    await asyncio.sleep(1)

                elif field_type == "file":      
                    file_input = await wait_for_element(page, selector, timeout=10)
                    if file_input and value:
                        await file_input.send_file(value)
                        await asyncio.sleep(1)

            except Exception as e:
                continue
        
        # PHASE 4: Handle asset_usage_sector LAST
        if "asset_usage_sector" in field_map and "asset_usage_sector" in record:
            selector = field_map["asset_usage_sector"]
            value = str(record["asset_usage_sector"] or "")
            
            select_element = await wait_for_element(page, selector, timeout=10)
            if select_element:
                options = select_element.children
                for option in options:
                    option_attrs = option.attrs
                    option_value = option_attrs.get("value")
                    if option_value == value:
                        await option.select_option()
                        break

        # Continue/Save button logic
        if not is_last_step:
            continue_btn = await wait_for_element(page, "input[name='continue']", timeout=10)
            if continue_btn:
                await asyncio.sleep(0.5)
                await continue_btn.click()
                await asyncio.sleep(2)

                error_div = await wait_for_element(page, "div.alert.alert-danger", timeout=5)
                if error_div:
                    if retries < max_retries:
                        await asyncio.sleep(1)
                        return await fill_form(page, record, field_map, field_types, is_last_step, retries + 1, max_retries, skip_special_fields, control_state, batch_id, record_id, tab_id, progress_tracker, step_num)
                    else:
                        return {"status": "FAILED", "error": "Validation error found"}
                
                await wait_for_element(page, "input", timeout=10)
                return True
            else:
                return False
        else:
            save_btn = await wait_for_element(page, "input[type='submit'], input[name='save']", timeout=10)
            if save_btn:
                await asyncio.sleep(0.5)
                await save_btn.click()
                await asyncio.sleep(5)
                
                current_url = await page.evaluate("window.location.href")
                form_id = current_url.rstrip("/").split("/")[-1]

                if form_id:
                    await db.taqeemForms.update_one(
                        {"_id": record["_id"]},
                        {"$set": {"form_id": form_id}}
                    )
                    
                    if batch_id and record_id:
                        emit_progress("RECORD_SUCCESS", f"Record {record_id} processed successfully", batch_id, record_id=record_id, form_id=form_id, tab_id=tab_id)
                
                return {"status": "SAVED", "form_id": form_id}
            else:
                return {"status": "FAILED", "error": "Save button not found"}
            
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}

async def process_records_in_tab(page, records, batch_id, control_state, tab_id, total_records, progress_tracker, is_main_tab=False):
    """Process a subset of records in a single tab"""
    failed_count = 0
    success_count = 0
    total_in_tab = len(records)
    
    try:
        # Only emit TAB_STARTED for main tab
        if is_main_tab:
            emit_progress("TAB_STARTED", f"Main tab started processing {total_in_tab} records", 
                         batch_id, tab_id=tab_id, is_main_tab=True, total=total_records, current=0)
        
        for local_index, record in enumerate(records):
            record_id = str(record["_id"])
            
            if control_state:
                from worker_taqeem import check_control
                await check_control(control_state)
            
            # Skip if already processed
            if record.get("form_id"):
                if is_main_tab:
                    emit_progress("RECORD_SKIPPED", f"Record {local_index + 1}/{total_in_tab} already processed", batch_id, 
                                record_id=record_id)
                success_count += 1
                progress_tracker.record_completed()
                continue

            # Only emit detailed progress for main tab
            if is_main_tab:
                progress_tracker.update_main_tab_progress(1, local_index, total_in_tab)
                current_percentage = progress_tracker.get_overall_percentage(tab_id, 1, local_index, total_in_tab, is_main_tab=True)
                
                emit_progress("RECORD_STARTED", f"Starting record {local_index + 1}/{total_in_tab}", 
                             batch_id, record_id=record_id, 
                             current=progress_tracker.completed_records, total=total_records)

            try:
                # Navigate to form
                await page.get("https://qima.taqeem.sa/report/create/1/137")
                await asyncio.sleep(2)

                record_failed = False
                for step_num, step_config in enumerate(form_steps, 1):
                    is_last_step = (step_num == len(form_steps))
                    
                    # Only update progress for main tab
                    if is_main_tab:
                        progress_tracker.update_main_tab_progress(step_num, local_index, total_in_tab)
                        current_percentage = progress_tracker.get_overall_percentage(tab_id, step_num, local_index, total_in_tab, is_main_tab=True)
                        
                        step_message = f"Record {local_index + 1}/{total_in_tab}, Step {step_num}/{len(form_steps)}"
                        emit_progress("STEP_PROGRESS", step_message, batch_id,
                                    record_id=record_id, step=step_num,
                                    current=progress_tracker.completed_records, total=total_records)
                    
                    result = await fill_form(
                        page, 
                        record, 
                        step_config["field_map"], 
                        step_config["field_types"], 
                        is_last_step, 
                        skip_special_fields=True,
                        control_state=control_state, 
                        batch_id=batch_id, 
                        record_id=record_id,
                        tab_id=tab_id,
                        progress_tracker=progress_tracker,
                        step_num=step_num
                    )

                    if isinstance(result, dict) and result.get("status") == "FAILED":
                        record_failed = True
                        failed_count += 1
                        if is_main_tab:
                            emit_progress("STEP_FAILED", f"Step {step_num} failed", batch_id,
                                        record_id=record_id, step=step_num, error=result.get("error"))
                        break

                if not record_failed:
                    success_count += 1
                    if is_main_tab:
                        emit_progress("RECORD_COMPLETED", f"Record {local_index + 1} completed", batch_id,
                                    record_id=record_id)
                
                # Update progress tracker
                progress_tracker.record_completed()
                if is_main_tab:
                    progress_tracker.update_main_tab_progress(len(form_steps) + 1, local_index + 1, total_in_tab)
                    
                    # Emit progress after record completion
                    current_percentage = progress_tracker.get_overall_percentage(tab_id, len(form_steps) + 1, local_index + 1, total_in_tab, is_main_tab=True)
                    emit_progress("PROCESSING", f"Completed {local_index + 1}/{total_in_tab}",
                                batch_id, current=progress_tracker.completed_records, total=total_records)
            
            except Exception as e:
                failed_count += 1
                progress_tracker.record_completed()
                
                if is_main_tab:
                    emit_progress("RECORD_FAILED", f"Record {local_index + 1} failed - {str(e)}", 
                                batch_id, record_id=record_id, error=str(e))
                    
                    emit_progress("PROCESSING", f"Continuing after failure", 
                                batch_id, current=progress_tracker.completed_records, total=total_records)

        if is_main_tab:
            emit_progress("TAB_COMPLETED", f"Main tab finished: {success_count} successful, {failed_count} failed", 
                         batch_id, success_count=success_count, failed_count=failed_count)
        
        return {"success": success_count, "failed": failed_count}
        
    except Exception as e:
        if is_main_tab:
            emit_progress("TAB_FAILED", f"Main tab failed: {str(e)}", batch_id, error=str(e))
        return {"success": success_count, "failed": failed_count}

def distribute_records(records, num_tabs):
    """Distribute records as evenly as possible across tabs"""
    total = len(records)
    base_count = total // num_tabs
    remainder = total % num_tabs
    
    distributed = []
    start_idx = 0
    
    for i in range(num_tabs):
        # First 'remainder' tabs get one extra record
        count = base_count + (1 if i < remainder else 0)
        end_idx = start_idx + count
        distributed.append(records[start_idx:end_idx])
        start_idx = end_idx
    
    return distributed

async def runFormFill(browser, batch_id, control_state=None, num_tabs=1):
    try:
        emit_progress("INITIALIZING", f"Initializing batch processing with {num_tabs} tabs", batch_id)
        
        cursor_upper = db.taqeemForms.find({"batch_id": batch_id})
        records = await cursor_upper.to_list(length=None)
        
        if not records:
            emit_progress("NO_RECORDS", f"No records found for batch {batch_id}", batch_id)
            return {"status": "FAILED", "error": f"No records for batchId={batch_id}"}

        total_records = len(records)
        
        # Ensure we don't use more tabs than records
        actual_tabs = min(num_tabs, total_records)
        
        # Initialize progress tracker
        progress_tracker = ProgressTracker(total_records, actual_tabs)
        
        emit_progress("DATA_FETCHED", f"Found {total_records} records, distributing across {actual_tabs} tabs", 
                     batch_id, total=total_records, num_tabs=actual_tabs, current=0)

        # Distribute records across tabs
        distributed_records = distribute_records(records, actual_tabs)
        
        # Log distribution
        for i, tab_records in enumerate(distributed_records):
            print(f"Tab {i+1}: {len(tab_records)} records", file=sys.stderr)

        # Get main tab
        main_tab = browser.main_tab
        
        if not main_tab:
            emit_progress("ERROR", "No browser tab available", batch_id)
            return {"status": "FAILED", "error": "No browser tab available"}
        
        # Navigate main tab to form
        await main_tab.get("https://qima.taqeem.sa/report/create/1/137")
        await asyncio.sleep(2)
        
        # Process records in parallel using multiple tabs
        tasks = []
        pages_to_close = []
        
        for tab_id, tab_records in enumerate(distributed_records, 1):
            if not tab_records:  # Skip if no records
                continue
                
            if tab_id == 1:
                # Use main tab for first batch
                task = process_records_in_tab(
                    main_tab, 
                    tab_records, 
                    batch_id, 
                    control_state, 
                    tab_id,
                    total_records,
                    progress_tracker,
                    is_main_tab=True
                )
            else:
                # Create new tabs for remaining batches
                new_tab = await browser.get("https://qima.taqeem.sa/report/create/1/137", new_tab=True)
                await asyncio.sleep(2)
                pages_to_close.append(new_tab)
                
                task = process_records_in_tab(
                    new_tab, 
                    tab_records, 
                    batch_id, 
                    control_state, 
                    tab_id,
                    total_records,
                    progress_tracker,
                    is_main_tab=False
                )
            
            tasks.append(task)

        # Wait for all tabs to complete
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Close additional tabs (but not main tab)
        for page in pages_to_close:
            try:
                await page.close()
            except Exception as e:
                print(f"Error closing tab: {e}", file=sys.stderr)
        
        # Aggregate results
        total_success = 0
        total_failed = 0
        
        for result in results:
            if isinstance(result, dict):
                total_success += result.get("success", 0)
                total_failed += result.get("failed", 0)
            elif isinstance(result, Exception):
                print(f"Tab error: {result}", file=sys.stderr)
                total_failed += 1

        # Final completion emit
        emit_progress("COMPLETED", 
                     f"Batch processing complete: {total_success} successful, {total_failed} failed across {actual_tabs} tabs", 
                     batch_id, 
                     success_count=total_success, 
                     failed_count=total_failed, 
                     total=total_records, 
                     current=total_records)

        return {
            "status": "SUCCESS", 
            "batchId": batch_id, 
            "successful_records": total_success,
            "failed_records": total_failed,
            "total_records": total_records,
            "tabs_used": actual_tabs
        }

    except Exception as e:
        tb = traceback.format_exc()
        emit_progress("BATCH_FAILED", f"Batch processing failed: {str(e)}", batch_id, error=str(e))
        return {"status": "FAILED", "error": str(e), "traceback": tb}