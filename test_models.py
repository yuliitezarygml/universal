import urllib.request
import json
import time
import sys
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

# Отключаем строгую проверку локальных сертификатов macOS
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

BASE_URL = "https://venues-gain-omissions-often.trycloudflare.com/v1"
API_KEY = "sk-788a1fbd337506a0-e4b195-bd5ad76a"

def get_all_models():
    req = urllib.request.Request(f"{BASE_URL}/models")
    req.add_header("Authorization", f"Bearer {API_KEY}")
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_context) as resp:
            data = json.loads(resp.read().decode())
            return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        print(f"❌ Ошибка получения списка моделей: {e}")
        return []

def test_single_model(model_id):
    prompt = "Write a python function to check if a number is even. Reply with only code."
    payload = json.dumps({
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 100
    }).encode("utf-8")
    
    req = urllib.request.Request(f"{BASE_URL}/chat/completions", data=payload)
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Content-Type", "application/json")
    
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_context) as resp:

            elapsed = round(time.time() - start, 2)
            data = json.loads(resp.read().decode())
            choices = data.get("choices", [])
            if choices and choices[0].get("message", {}).get("content"):
                content = choices[0]["message"]["content"].strip()
                has_code = "def " in content or "return " in content or "lambda" in content
                if has_code:
                    return {"model": model_id, "status": "OK", "time": elapsed, "preview": content[:45].replace("\n", " ")}
                else:
                    return {"model": model_id, "status": "ERR", "msg": "Ответил не кодом"}
            elif "error" in data:
                return {"model": model_id, "status": "ERR", "msg": data["error"].get("message", "")[:50]}
            else:
                return {"model": model_id, "status": "ERR", "msg": "Пустой ответ"}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        try:
            err_data = json.loads(body)
            msg = err_data.get("error", {}).get("message", body[:50])
        except:
            msg = body[:50]
        return {"model": model_id, "status": "ERR", "code": e.code, "msg": msg.replace("\n", " ")[:50]}
    except Exception as e:
        return {"model": model_id, "status": "ERR", "msg": str(e)[:50]}

def main():
    print("=" * 70)
    print("🔍 ПОДКЛЮЧЕНИЕ К ШЛЮЗУ OMNIROUTE...")
    print(f"URL: {BASE_URL}")
    print("=" * 70)
    
    all_models = get_all_models()
    if not all_models:
        print("Не удалось загрузить модели. Проверьте интернет и шлюз.")
        return
        
    print(f"📦 Всего моделей в шлюзе: {len(all_models)}")
    
    # Отбираем модели для кодинга
    keywords = ["coder", "code", "qwen", "deepseek", "llama-3.3", "codestral", "glm-5", "glm-4", "qwq"]
    candidates = []
    
    for mid in all_models:
        if mid.startswith("auto/") or mid.startswith("combo"):
            continue
        lower = mid.lower()
        if any(k in lower for k in keywords):
            candidates.append(mid)
            
    candidates = list(dict.fromkeys(candidates))
    print(f"🎯 Отобрано кандидатов для кодинга: {len(candidates)}")
    print("⚡ Запуск параллельного тестирования (15 потоков)...\n")
    
    working = []
    failed = []
    
    with ThreadPoolExecutor(max_workers=15) as executor:
        future_to_model = {executor.submit(test_single_model, m): m for m in candidates}
        completed = 0
        for future in as_completed(future_to_model):
            completed += 1
            res = future.result()
            m = res["model"]
            if res["status"] == "OK":
                print(f"[{completed:03d}/{len(candidates)}] \033[92m✅ РАБОТАЕТ\033[0m ({res['time']}s) | \033[1m{m}\033[0m -> {res['preview']}")
                working.append(res)
            else:
                reason = res.get("msg", "Error")
                print(f"[{completed:03d}/{len(candidates)}] \033[91m❌ СБОЙ\033[0m    | {m} -> {reason}")
                failed.append(res)
                
    print("\n" + "=" * 70)
    print(f"🏁 ИТОГИ ТЕСТИРОВАНИЯ:")
    print(f"\033[92m✅ Реально работают и пишут код: {len(working)}\033[0m")
    print(f"\033[91m❌ Не работают (кончились кредиты/сбой моста): {len(failed)}\033[0m")
    print("=" * 70)
    
    working.sort(key=lambda x: x["time"])
    print("\n🏆 СПИСОК 100% РАБОЧИХ МОДЕЛЕЙ ДЛЯ КОДИНГА (по скорости):")
    for item in working:
        print(f"  \"{item['model']}\",  # {item['time']} сек")
        
    # Сохраняем в файл working_models.json
    with open("working_models.json", "w", encoding="utf-8") as f:
        json.dump([item["model"] for item in working], f, indent=2, ensure_ascii=False)
    print("\n💾 Список рабочих моделей сохранен в: working_models.json")

if __name__ == "__main__":
    main()
