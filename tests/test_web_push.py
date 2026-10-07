import web_push


class Cloud:
    enabled, url = True, "https://x.supabase.co"

    @staticmethod
    def _headers():
        return {}


def test_sends_only_to_followers_and_drops_gone(monkeypatch):
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "k")
    p = web_push.WebPush(Cloud())
    p.subs = [
        {"id": 1, "endpoint": "https://a", "p256dh": "x", "auth": "y", "strategies": ["trend"]},
        {"id": 2, "endpoint": "https://b", "p256dh": "x", "auth": "y", "strategies": ["trend", "h4"]},
        {"id": 3, "endpoint": "https://c", "p256dh": "x", "auth": "y", "strategies": ["h4"]},
    ]
    p.read_at = 9e18
    sent, deleted = [], []

    import pywebpush

    class Gone:
        status_code = 410

    def fake(sub, data, **kw):
        if sub["endpoint"] == "https://b":
            raise pywebpush.WebPushException("gone", response=Gone())
        sent.append((sub["endpoint"], data))

    monkeypatch.setattr(pywebpush, "webpush", fake)
    p._rest = lambda method, params=None, **kw: deleted.append(params)
    p._send("trend", "hello", "T", "tag")
    assert [e for e, _ in sent] == ["https://a"] and '"hello"' in sent[0][1]
    assert deleted == [{"id": "in.(2)"}] and [s["id"] for s in p.subs] == [1, 3]
