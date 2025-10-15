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
    
    # Auto-calculate percentage if current and total are provided
    if 'current' in kwargs and 'total' in kwargs and kwargs['total'] > 0:
        progress_data['percentage'] = round((kwargs['current'] / kwargs['total']) * 100, 2)
    
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
    
    # Debug: Log what fields we're attempting to fill
    print(json.dumps({
        "type": "DEBUG", 
        "message": f"Processing {len(field_map)} fields from field_map"
    }), flush=True)
    
    print(json.dumps({
        "type": "DEBUG", 
        "message": f"Record keys available: {list(record.keys())}"
    }), flush=True)

    for key, selector in field_map.items():
        if key not in record:
            print(json.dumps({
                "type": "DEBUG", 
                "message": f"Field '{key}' not in record - skipping"
            }), flush=True)
            continue

        field_type = field_types.get(key, "text")
        value = str(record[key] or "").strip()
        
        # Log which fields we're preparing to inject
        print(json.dumps({
            "type": "DEBUG", 
            "message": f"Preparing field '{key}' with selector '{selector}' and value '{value[:50]}...'"
        }), flush=True)

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

    # Enhanced JavaScript with detailed logging
    js = f"""
    (function() {{
        const data = {json.dumps(jsdata)};
        let successCount = 0;
        let failCount = 0;
        const failures = [];
        
        console.log('🔍 Starting bulk inject with', Object.keys(data).length, 'fields');
        
        for (const [selector, meta] of Object.entries(data)) {{
            console.log('📍 Attempting:', selector, '| Type:', meta.type, '| Value:', meta.value?.substring(0, 50));
            
            const el = document.querySelector(selector);
            if (!el) {{
                console.error('❌ Element NOT FOUND:', selector);
                failures.push({{selector, reason: 'Element not found'}});
                failCount++;
                continue;
            }}
            
            console.log('✅ Found element:', el.tagName, '| Name:', el.name, '| Type:', el.type);

            try {{
                switch(meta.type) {{
                    case "checkbox":
                        el.checked = Boolean(meta.value);
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        console.log('✓ Checkbox set:', el.checked);
                        break;

                    case "select":
                        let found = false;
                        console.log('🔍 Select has', el.options.length, 'options');
                        for (const opt of el.options) {{
                            if (opt.value == meta.value || opt.text == meta.value) {{
                                el.value = opt.value;
                                found = true;
                                console.log('✓ Select option matched:', opt.value, opt.text);
                                break;
                            }}
                        }}
                        if (!found && el.options.length) {{
                            console.warn('⚠️ No matching option found, setting to first option');
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
                                    console.log('✓ Radio button set:', radio.id);
                                    radioFound = true;
                                    break;
                                }}
                            }}
                        }}
                        if (!radioFound) {{
                            console.warn('⚠️ Radio button not found for value:', meta.value);
                        }}
                        break;

                    case "date":
                    case "text":
                    default:
                        const oldValue = el.value;
                        el.value = meta.value ?? "";
                        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        console.log('✓ Text/date set:', oldValue, '->', el.value);
                        break;
                }}
                successCount++;
            }} catch(err) {{
                console.error('❌ Error setting value:', err.message);
                failures.push({{selector, reason: err.message}});
                failCount++;
            }}
        }}
        
        console.log('📊 Bulk inject complete:', successCount, 'succeeded,', failCount, 'failed');
        if (failures.length > 0) {{
            console.error('❌ Failed fields:', failures);
        }}
        
        return {{successCount, failCount, failures}};
    }})();
    """

    try:
        result = await page.evaluate(js)
        # Handle the case where result might be a list or None
        if isinstance(result, dict):
            print(json.dumps({
                "type": "DEBUG", 
                "message": f"Bulk inject result: {result.get('successCount', 0)} succeeded, {result.get('failCount', 0)} failed"
            }), flush=True)
            
            if result.get('failures'):
                print(json.dumps({
                    "type": "WARNING", 
                    "message": f"Failed to inject fields: {result['failures']}"
                }), flush=True)
        else:
            # If result is not a dictionary (might be None, list, etc.)
            print(json.dumps({
                "type": "DEBUG", 
                "message": f"Bulk inject completed (non-dict result: {type(result)})"
            }), flush=True)
            
    except Exception as e:
        print(json.dumps({
            "type": "ERROR", 
            "message": f"JavaScript evaluation failed: {str(e)}"
        }), flush=True)

async def fill_form(page, record, field_map, field_types, is_last_step=False, retries=0, max_retries=2, skip_special_fields=False, control_state=None, batch_id=None, record_id=None):
    try:
        # Check for pause/stop
        if control_state:
            from worker_taqeem import check_control
            await check_control(control_state)
        
        start_time = time.time()
        
        # PHASE 1: Handle asset_type FIRST (if present)
        if "asset_type" in field_map and "asset_type" in record:
            selector = field_map["asset_type"]
            value = str(record["asset_type"] or "")
            
            print(json.dumps({
                "type": "DEBUG", 
                "message": f"PHASE 1: Setting asset_type with value '{value}'"
            }), flush=True)
            
            select_element = await wait_for_element(page, selector, timeout=10)
            if select_element:
                options = select_element.children
                for option in options:
                    option_attrs = option.attrs
                    option_value = option_attrs.get("value")
                    if option_value == value:
                        print(json.dumps({
                            "type": "DEBUG", 
                            "message": f"Found match for asset_type: {value}"
                        }), flush=True)
                        await option.select_option()
                        break
        
        # PHASE 2: Bulk inject all fields EXCEPT dynamic_select fields
        bulk_field_map = {}
        bulk_field_types = {}
        
        for key, selector in field_map.items():
            field_type = field_types.get(key, "text")
            # Exclude all dynamic_select, location, and file fields from bulk injection
            if field_type not in ["dynamic_select", "location", "file"]:
                bulk_field_map[key] = selector
                bulk_field_types[key] = field_type
        
        print(json.dumps({
            "type": "DEBUG", 
            "message": f"PHASE 2: Bulk injecting {len(bulk_field_map)} standard fields"
        }), flush=True)
        
        await bulk_inject_inputs(page, record, bulk_field_map, bulk_field_types)
        await asyncio.sleep(1)
        
        # PHASE 3: Handle other special fields (location, file) but NOT asset_usage_sector yet
        print(json.dumps({
            "type": "DEBUG", 
            "message": "PHASE 3: Processing location and file fields"
        }), flush=True)
        
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
                print(json.dumps({
                    "type": "DEBUG", 
                    "message": f"Error handling special field {key}: {str(e)}"
                }), flush=True)
                continue
        
        # PHASE 4: Handle asset_usage_sector LAST (if present and not asset_type)
        if "asset_usage_sector" in field_map and "asset_usage_sector" in record:
            selector = field_map["asset_usage_sector"]
            value = str(record["asset_usage_sector"] or "")
            
            print(json.dumps({
                "type": "DEBUG", 
                "message": f"PHASE 4: Setting asset_usage_sector with value '{value}'"
            }), flush=True)
            
            # Wait extra time to ensure asset_type has fully loaded dependencies            
            select_element = await wait_for_element(page, selector, timeout=10)
            if select_element:
                options = select_element.children
                for option in options:
                    option_attrs = option.attrs
                    option_value = option_attrs.get("value")
                    if option_value == value:
                        print(json.dumps({
                            "type": "DEBUG", 
                            "message": f"Found match for asset_usage_sector: {value}"
                        }), flush=True)
                        await option.select_option()
                        break
                else:
                    print(json.dumps({
                        "type": "WARNING", 
                        "message": f"No match found for asset_usage_sector value: {value}"
                    }), flush=True)
            else:
                print(json.dumps({
                    "type": "WARNING", 
                    "message": f"asset_usage_sector selector not found: {selector}"
                }), flush=True)

        end_time = time.time()

        # Continue button logic (unchanged)
        if not is_last_step:
            continue_btn = await wait_for_element(page, "input[name='continue']", timeout=10)
            if continue_btn:
                print(json.dumps({
                    "type": "DEBUG", 
                    "message": "Clicking continue button..."
                }), flush=True)
                
                await asyncio.sleep(0.5)
                await continue_btn.click()
                await asyncio.sleep(2)

                error_div = await wait_for_element(page, "div.alert.alert-danger", timeout=5)
                if error_div:
                    print(json.dumps({
                        "type": "DEBUG", 
                        "message": "Validation error found: retrying step"
                    }), flush=True)
                    
                    if retries < max_retries:
                        await asyncio.sleep(1)
                        return await fill_form(page, record, field_map, field_types, is_last_step, retries + 1, max_retries, skip_special_fields, control_state, batch_id, record_id)
                    else:
                        return {"status": "FAILED", "error": "Validation error found"}
                
                await wait_for_element(page, "input", timeout=10)
                return True
            else:
                print(json.dumps({
                    "type": "DEBUG", 
                    "message": "No continue button found - may be on final step"
                }), flush=True)
                return False
        else:
            print(json.dumps({
                "type": "DEBUG", 
                "message": "Last step completed - clicking save button"
            }), flush=True)
            
            save_btn = await wait_for_element(page, "input[type='submit'], input[name='save']", timeout=10)
            if save_btn:
                await asyncio.sleep(0.5)
                await save_btn.click()
                await asyncio.sleep(5)
                
                current_url = await page.evaluate("window.location.href")
                print(json.dumps({
                    "type": "DEBUG", 
                    "message": f"Current URL: {current_url}"
                }), flush=True)
                
                form_id = current_url.rstrip("/").split("/")[-1]
                print(json.dumps({
                    "type": "DEBUG", 
                    "message": f"Extracted form id: {form_id}"
                }), flush=True)

                if form_id:
                    await db.taqeemForms.update_one(
                        {"_id": record["_id"]},
                        {"$set": {"form_id": form_id}}
                    )

                    print(json.dumps({
                        "type": "DEBUG", 
                        "message": f"Updated record {record['_id']} with form id {form_id}"
                    }), flush=True)
                    
                    # Emit success progress
                    if batch_id and record_id:
                        emit_progress("RECORD_SUCCESS", f"Record {record_id} processed successfully", batch_id, record_id=record_id, form_id=form_id)
                
                return {"status": "SAVED", "form_id": form_id}
            else:
                return {"status": "FAILED", "error": "Save button not found"}
            
    except Exception as e:
        print(json.dumps({
            "type": "ERROR", 
            "message": f"Error filling form: {e}"
        }), flush=True)
        return {"status": "FAILED", "error": str(e)}

async def runFormFill(browser, batch_id, control_state=None):
    try:
        emit_progress("FETCHING_DATA", f"Fetching records for batch {batch_id}", batch_id)
        
        cursor_upper = db.taqeemForms.find({"batch_id": batch_id})
        
        records_upper = await cursor_upper.to_list(length=None)
        
        # Choose the collection that has records
        if records_upper:
            records = records_upper
            collection_name = "taqeemForms"
        else:
            emit_progress("NO_RECORDS", f"No records found for batch {batch_id}", batch_id)
            return {"status": "FAILED", "error": f"No records for batchId={batch_id}"}

        total_records = len(records)
        emit_progress("DATA_FETCHED", f"Found {total_records} records in {collection_name}", batch_id, 
                     total=total_records, current=0, percentage=0)

        # Navigate to the form URL using the browser
        emit_progress("NAVIGATING", "Navigating to form page", batch_id, 
                     total=total_records, current=0, percentage=0)
        page = browser.main_tab
        await page.get("https://qima.taqeem.sa/report/create/1/137")
        await asyncio.sleep(2)
        
        # Verify we're on the correct page
        current_url = await page.evaluate("window.location.href")
        emit_progress("PAGE_LOADED", f"Loaded page: {current_url}", batch_id, 
                     total=total_records, current=0, percentage=0)

        failed_count = 0
        success_count = 0
        
        for index, record in enumerate(records):
            record_id = str(record["_id"])
            
            # Check for pause/stop
            if control_state:
                from worker_taqeem import check_control
                await check_control(control_state)
            
            # Skip if already processed
            if record.get("form_id"):
                emit_progress("RECORD_SKIPPED", f"Record {record_id} already processed", batch_id, 
                            record_id=record_id, current=index + 1, total=total_records)
                success_count += 1
                continue

            current_progress = index + 1
            percentage = round((current_progress / total_records) * 99, 2)
            
            emit_progress("RECORD_STARTED", f"Processing record {current_progress}/{total_records}", batch_id, 
                         record_id=record_id, current=current_progress, total=total_records, percentage=percentage)

            # For subsequent records after the first one, navigate to the form start
            if index > 0:
                emit_progress("NAVIGATING", f"Navigating to form for record {current_progress}", batch_id, 
                            record_id=record_id, current=current_progress, total=total_records, percentage=percentage)
                await page.get("https://qima.taqeem.sa/report/create/1/137")

            record_failed = False
            for step_num, step_config in enumerate(form_steps, 1):
                is_last_step = (step_num == len(form_steps))
                
                emit_progress("STEP_STARTED", f"Starting step {step_num}/{len(form_steps)}", batch_id,
                            record_id=record_id, step=step_num, total_steps=len(form_steps),
                            current=current_progress, total=total_records, percentage=percentage)

                result = await fill_form(
                    page, 
                    record, 
                    step_config["field_map"], 
                    step_config["field_types"], 
                    is_last_step, 
                    skip_special_fields=True,
                    control_state=control_state, 
                    batch_id=batch_id, 
                    record_id=record_id
                )

                if isinstance(result, dict) and result.get("status") == "FAILED":
                    record_failed = True
                    failed_count += 1
                    emit_progress("STEP_FAILED", f"Step {step_num} failed", batch_id,
                                record_id=record_id, step=step_num, error=result.get("error"),
                                current=current_progress, total=total_records, percentage=percentage)
                    break
                else:
                    emit_progress("STEP_COMPLETED", f"Completed step {step_num}/{len(form_steps)}", batch_id,
                                record_id=record_id, step=step_num, total_steps=len(form_steps),
                                current=current_progress, total=total_records, percentage=percentage)

            if not record_failed:
                success_count += 1
                emit_progress("RECORD_COMPLETED", f"Record {current_progress} completed successfully", batch_id,
                            record_id=record_id, current=current_progress, total=total_records, percentage=percentage)

        # Final progress update with 100% completion
        emit_progress("BATCH_COMPLETED", f"Batch processing completed: {success_count} successful, {failed_count} failed", 
                     batch_id, success_count=success_count, failed_count=failed_count, 
                     total=total_records, current=total_records, percentage=100)

        return {
            "status": "SUCCESS", 
            "batchId": batch_id, 
            "successful_records": success_count,
            "failed_records": failed_count,
            "total_records": total_records,
            "collection_used": collection_name
        }

    except Exception as e:
        tb = traceback.format_exc()
        emit_progress("BATCH_FAILED", f"Batch processing failed: {str(e)}", batch_id, error=str(e))
        return {"status": "FAILED", "error": str(e), "traceback": tb}