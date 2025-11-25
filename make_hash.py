import hashlib

# CHANGE THIS to your desired password
password = "DellSec2025"

# Generate Hash
hash_object = hashlib.sha256(password.encode())
hex_dig = hash_object.hexdigest()

print(f"Your Password: {password}")
print(f"Your Secure Hash: {hex_dig}")
