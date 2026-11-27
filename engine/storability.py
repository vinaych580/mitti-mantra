"""How long each crop keeps after harvest, for sell-or-hold advice."""
from __future__ import annotations

#: How many weeks a crop keeps in ordinary farm storage (no cold chain), as sold at
#: the mandi. Holding longer than this is not offered: the price forecast says
#: nothing about produce that has rotted. Rough agronomic figures (ICAR / NHB
#: post-harvest guidance): fresh fruit and vegetables keep days to a couple of weeks,
#: fresh ginger about a month, potato a season in heaps, rabi onion four to five
#: months in ventilated stores; sugarcane must be crushed within a day or two of
#: cutting. Crops not listed (grains, pulses, oilseeds, fibre, dried spices) keep
#: past the longest forecast horizon.
MAX_STORAGE_WEEKS = {
    "tomato": 1, "banana": 1, "mango": 1, "cucumber": 1, "muskmelon": 1, "watermelon": 2,
    "ginger": 4, "coconut": 8, "potato": 12, "onion": 20, "sugarcane": 0,
}


def max_storage_weeks(crop_id: str) -> int | None:
    return MAX_STORAGE_WEEKS.get(crop_id)
