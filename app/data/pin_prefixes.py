"""India Post PIN-code prefix to state/UT table, bundled so no API is called.

Lookup order in `talent_pool_inference.state_from_pin`:
  1. PIN_RANGES  -- six-digit ranges for the few places that sit inside another
                    state's prefix (Puducherry, Lakshadweep, Daman and Diu ...).
  2. PIN_PREFIX3 -- three-digit prefixes, where the two-digit one is not enough.
  3. PIN_PREFIX2 -- the postal circle, i.e. the first two digits.
A prefix that is not in the table answers None: PINs starting 9 are Army Post
Office numbers (no geography), and the prefixes in AMBIGUOUS_PREFIX3 straddle a
state border, so a guess there would be wrong for some real addresses.

Deliberately NOT answered (None): 244, 246, 247, 262 (Uttar Pradesh and
Uttarakhand share them), 605100-605599 (Puducherry enclaves and Tamil Nadu's
Villupuram district share them).
"""

PIN_PREFIX2: dict[str, str] = {
    "11": "Delhi",
    "12": "Haryana", "13": "Haryana",
    "14": "Punjab", "15": "Punjab", "16": "Punjab",
    "17": "Himachal Pradesh",
    "18": "Jammu and Kashmir", "19": "Jammu and Kashmir",
    "20": "Uttar Pradesh", "21": "Uttar Pradesh", "22": "Uttar Pradesh", "23": "Uttar Pradesh",
    "25": "Uttar Pradesh", "27": "Uttar Pradesh", "28": "Uttar Pradesh",
    "30": "Rajasthan", "31": "Rajasthan", "32": "Rajasthan", "33": "Rajasthan", "34": "Rajasthan",
    "36": "Gujarat", "37": "Gujarat", "38": "Gujarat", "39": "Gujarat",
    "40": "Maharashtra", "41": "Maharashtra", "42": "Maharashtra", "43": "Maharashtra", "44": "Maharashtra",
    "45": "Madhya Pradesh", "46": "Madhya Pradesh", "47": "Madhya Pradesh", "48": "Madhya Pradesh",
    "49": "Chhattisgarh",
    "50": "Telangana",
    "51": "Andhra Pradesh", "52": "Andhra Pradesh", "53": "Andhra Pradesh",
    "56": "Karnataka", "57": "Karnataka", "58": "Karnataka", "59": "Karnataka",
    "60": "Tamil Nadu", "61": "Tamil Nadu", "62": "Tamil Nadu", "63": "Tamil Nadu", "64": "Tamil Nadu",
    "67": "Kerala", "68": "Kerala", "69": "Kerala",
    "70": "West Bengal", "71": "West Bengal", "72": "West Bengal", "73": "West Bengal", "74": "West Bengal",
    "75": "Odisha", "76": "Odisha", "77": "Odisha",
    "78": "Assam",
    "80": "Bihar",
    "83": "Jharkhand",
    "84": "Bihar", "85": "Bihar",
}

# Where the two-digit circle is mixed or the state is smaller than the circle.
PIN_PREFIX3: dict[str, str] = {
    # Uttar Pradesh / Uttarakhand circles
    "241": "Uttar Pradesh", "242": "Uttar Pradesh", "243": "Uttar Pradesh", "245": "Uttar Pradesh",
    "248": "Uttarakhand", "249": "Uttarakhand",
    "261": "Uttar Pradesh", "263": "Uttarakhand",
    # Goa is cut out of Maharashtra's 40
    "403": "Goa",
    # Sikkim is cut out of West Bengal's 73
    "737": "Sikkim",
    # Andaman and Nicobar is cut out of West Bengal's 74
    "744": "Andaman and Nicobar Islands",
    # Ladakh (Leh, Kargil) is cut out of Jammu and Kashmir's 19
    "194": "Ladakh",
    # North-east
    "790": "Arunachal Pradesh", "791": "Arunachal Pradesh", "792": "Arunachal Pradesh",
    "793": "Meghalaya", "794": "Meghalaya",
    "795": "Manipur",
    "796": "Mizoram",
    "797": "Nagaland", "798": "Nagaland",
    "799": "Tripura",
    # Bihar / Jharkhand circles
    "811": "Bihar", "812": "Bihar", "813": "Bihar",
    "814": "Jharkhand", "815": "Jharkhand", "816": "Jharkhand",
    "821": "Bihar", "822": "Jharkhand", "823": "Bihar", "824": "Bihar",
    "825": "Jharkhand", "826": "Jharkhand", "827": "Jharkhand", "828": "Jharkhand", "829": "Jharkhand",
}

# Prefixes that straddle a state border with no cleaner split.
AMBIGUOUS_PREFIX3: frozenset[str] = frozenset({"244", "246", "247", "262"})

# (low, high, state), inclusive, checked before the prefixes. Best effort from
# India Post's published ranges; a PIN in none of them falls through to the
# prefix tables above.
PIN_RANGES: list[tuple[int, int, str]] = [
    # Chandigarh is 160001-160047 and 160101-160104; Mohali (Punjab) sits at 1600xx above that.
    (160001, 160049, "Chandigarh"),
    (160050, 160099, "Punjab"),
    (160100, 160199, "Chandigarh"),
    # Puducherry city is 605001-605014; Villupuram district (Tamil Nadu) starts at 605601.
    (605001, 605014, "Puducherry"),
    (605100, 605599, ""),  # mixed: answered None
    (605600, 605999, "Tamil Nadu"),
    # Puducherry's other enclaves: Karaikal, Mahe, Yanam.
    (609601, 609609, "Puducherry"),
    # Bahour commune sits inside Tamil Nadu's 607 (checked 2026-11-09).
    (607402, 607402, "Puducherry"),
    (673310, 673311, "Puducherry"),
    (533464, 533464, "Puducherry"),
    # Lakshadweep islands sit inside Ernakulam's 682.
    (682550, 682559, "Lakshadweep"),
    # Diu sits inside Junagadh's 362; Daman and Dadra and Nagar Haveli inside Valsad's 396.
    (362520, 362570, "Dadra and Nagar Haveli and Daman and Diu"),
    (396193, 396193, "Dadra and Nagar Haveli and Daman and Diu"),
    (396210, 396240, "Dadra and Nagar Haveli and Daman and Diu"),
]
