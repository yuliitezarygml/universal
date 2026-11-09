import urllib.request
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "http://89.149.118.186:5008/v1"
API_KEY = "vrk_13b25c0b06cba9de524e431ecebfce22"

def test_model(m):
    payload = json.dumps({
        "model": m,
        "messages": [{"role": "user", "content": "Write a python function to check if a number is even. Reply with only code."}],
        "max_tokens": 100
    }).encode("utf-8")
    
    req = urllib.request.Request(f"{BASE_URL}/chat/completions", data=payload)
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Content-Type", "application/json")
    
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            elapsed = round(time.time() - start, 2)
            data = json.loads(resp.read().decode())
            choices = data.get("choices", [])
            if choices and choices[0].get("message", {}).get("content"):
                content = choices[0]["message"]["content"].strip()
                has_code = "def " in content or "return " in content or "lambda" in content
                if has_code:
                    return {"model": m, "status": "OK", "time": elapsed, "preview": content[:45].replace("\n", " ")}
                else:
                    return {"model": m, "status": "ERR", "msg": "Ответил не кодом"}
            elif "error" in data:
                return {"model": m, "status": "ERR", "msg": data["error"].get("message", "")[:50]}
            else:
                return {"model": m, "status": "ERR", "msg": "Пустой ответ"}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        try:
            err = json.loads(body).get("error", {}).get("message", body[:50])
        except:
            err = body[:50]
        return {"model": m, "status": "ERR", "code": e.code, "msg": err.replace("\n", " ")[:50]}
    except Exception as e:
        return {"model": m, "status": "ERR", "msg": str(e)[:50]}

def main():
    req = urllib.request.Request(f"{BASE_URL}/models")
    req.add_header("Authorization", f"Bearer {API_KEY}")
    with urllib.request.urlopen(req) as resp:
        models = [m["id"] for m in json.loads(resp.read().decode())["data"]]

    print(f"Тестируем {len(models)} моделей на сервере {BASE_URL}...\n")
    working = []
    failed = []

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(test_model, m): m for m in models}
        for f in as_completed(futures):
            res = f.result()
            m = res["model"]
            t = res.get("time", 0)
            prev = res.get("preview", "")
            if res["status"] == "OK":
                print(f"✅ РАБОТАЕТ ({t}s) | {m} -> {prev}")
                working.append(res)
            else:
                reason = res.get("msg", "error")
                print(f"❌ СБОЙ    | {m} -> {reason}")
                failed.append(res)

    print("\n" + "="*70)
    print(f"ИТОГИ: Реально работают: {len(working)} из {len(models)}")
    print(f"Сбои / не работают: {len(failed)}")
    print("="*70)
    working.sort(key=lambda x: x["time"])
    print("\nТОП РАБОЧИХ МОДЕЛЕЙ (по скорости):")
    for item in working:
        print(f"- {item['model']} ({item['time']} сек)")

if __name__ == "__main__":
    main()
