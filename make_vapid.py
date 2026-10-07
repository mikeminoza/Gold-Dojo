"""Make the key pair for web push notifications (run once, on your PC):

    .venv/Scripts/python make_vapid.py

It prints two values. Paste them yourself (never in a chat or on GitHub):
    VAPID_PUBLIC_KEY   -> Render (bot) AND Vercel as NEXT_PUBLIC_VAPID_PUBLIC_KEY (it's public)
    VAPID_PRIVATE_KEY  -> Render (bot) only. Secret: whoever has it can send notifications as Gold Dojo.
Also set VAPID_EMAIL on Render (a contact address push services can reach, e.g. your email).
Making new keys later means every browser has to turn notifications on again.
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


key = ec.generate_private_key(ec.SECP256R1())
private = key.private_numbers().private_value.to_bytes(32, "big")
public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
print("VAPID_PUBLIC_KEY =", b64(public))
print("VAPID_PRIVATE_KEY =", b64(private))
