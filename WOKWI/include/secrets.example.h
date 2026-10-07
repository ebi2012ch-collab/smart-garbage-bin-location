#pragma once

#define API_BASE_URL "http://host.wokwi.internal:3000/api"
#define DEVICE_KEY "set-this-to-the-same-private-value-as-BACK-END-.env"

// Required when API_BASE_URL uses HTTPS. Paste the public root CA certificate
// that issued your API certificate. Leave empty for a local Private Gateway URL.
#define API_ROOT_CA ""
