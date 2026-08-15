"""Stable package facade for the source-built pyproc data module."""

import _pyprocData as _native

ABI_VERSION = _native.profile()
dot = _native.dot
dot_f64 = _native.dot_f64
vector_add = _native.vector_add
vector_add_f64 = _native.vector_add_f64


def inspect():
    """Return the native ABI and numerical implementation identity."""
    return {
        "abiVersion": ABI_VERSION,
        "origin": _native.__spec__.origin,
        "simd": _native.simd(),
    }
