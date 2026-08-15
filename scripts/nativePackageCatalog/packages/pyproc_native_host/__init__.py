"""Stable package facade for the source-built pyproc host module."""

import _pyprocHost as _native

ABI_VERSION = _native.abiVersion()
HostcallError = _native.HostcallError
HostcallTimeout = _native.HostcallTimeout
HostcallCancelled = _native.HostcallCancelled
HostcallBrokerLost = _native.HostcallBrokerLost
HostcallOutcomeUnknown = _native.HostcallOutcomeUnknown
HostcallDenied = _native.HostcallDenied
HostcallOverflow = _native.HostcallOverflow
call = _native.call
noop = _native.noop


def inspect():
    """Return the native ABI identity without crossing the hostcall boundary."""
    return {
        "abiVersion": ABI_VERSION,
        "origin": _native.__spec__.origin,
    }
