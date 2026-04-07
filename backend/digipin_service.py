"""
DigiPIN Generator
=================
Uses the official 'digipin' PyPI package to encode latitude and longitude
into a 10-character alphanumeric DigiPIN code — India Post's geospatial
digital addressing system.

Reference: https://pypi.org/project/digipin/
"""

from digipin import encode


def generate_digipin(lat: float, lng: float) -> str:
    """
    Convert latitude and longitude to a DigiPIN code using
    the official India Post DigiPIN algorithm.

    Returns a formatted code like: M2J-T3L-747J
    """
    return encode(lat, lng)
