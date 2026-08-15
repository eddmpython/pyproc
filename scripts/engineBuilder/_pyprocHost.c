#define PY_SSIZE_T_CLEAN
#include "Python.h"

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

#define PYPROC_HOSTCALL_MAGIC 0x50595048u
#define PYPROC_HOSTCALL_ABI 1u
#define PYPROC_HOSTCALL_REQUEST_HEADER 36u
#define PYPROC_HOSTCALL_RESPONSE_HEADER 20u
#define PYPROC_HOSTCALL_DATA_BYTES (1u << 20)

#define PYPROC_HOSTCALL_RESPONSE 3u
#define PYPROC_HOSTCALL_ERROR 4u
#define PYPROC_HOSTCALL_CANCELLED 5u
#define PYPROC_HOSTCALL_TIMEOUT 6u
#define PYPROC_HOSTCALL_BROKER_LOST 7u
#define PYPROC_HOSTCALL_OUTCOME_UNKNOWN 8u

#define PYPROC_HOSTCALL_ERROR_DENIED 2u
#define PYPROC_HOSTCALL_ERROR_OVERFLOW 3u

static uint64_t pyprocHostRequestId = 0;
static PyObject *PyProcHostError;
static PyObject *PyProcHostTimeout;
static PyObject *PyProcHostCancelled;
static PyObject *PyProcHostBrokerLost;
static PyObject *PyProcHostOutcomeUnknown;
static PyObject *PyProcHostDenied;
static PyObject *PyProcHostOverflow;

static void
writeU32(unsigned char *output, uint32_t value)
{
    output[0] = (unsigned char)(value & 0xffu);
    output[1] = (unsigned char)((value >> 8) & 0xffu);
    output[2] = (unsigned char)((value >> 16) & 0xffu);
    output[3] = (unsigned char)((value >> 24) & 0xffu);
}

static void
writeU64(unsigned char *output, uint64_t value)
{
    writeU32(output, (uint32_t)(value & 0xffffffffu));
    writeU32(output + 4, (uint32_t)(value >> 32));
}

static uint32_t
readU32(const unsigned char *input)
{
    return ((uint32_t)input[0])
        | ((uint32_t)input[1] << 8)
        | ((uint32_t)input[2] << 16)
        | ((uint32_t)input[3] << 24);
}

static int
writeAll(int fd, const unsigned char *bytes, size_t length)
{
    size_t offset = 0;
    while (offset < length) {
        ssize_t written = write(fd, bytes + offset, length - offset);
        if (written < 0 && errno == EINTR) {
            continue;
        }
        if (written <= 0) {
            return -1;
        }
        offset += (size_t)written;
    }
    return 0;
}

static int
readAll(int fd, unsigned char *bytes, size_t length)
{
    size_t offset = 0;
    while (offset < length) {
        ssize_t received = read(fd, bytes + offset, length - offset);
        if (received < 0 && errno == EINTR) {
            continue;
        }
        if (received <= 0) {
            return -1;
        }
        offset += (size_t)received;
    }
    return 0;
}

static PyObject *
pyprocHostAbiVersion(PyObject *self, PyObject *Py_UNUSED(ignored))
{
    return PyUnicode_FromString("pyproc.hostcall/1");
}

static PyObject *
pyprocHostNoop(PyObject *self, PyObject *Py_UNUSED(ignored))
{
    Py_RETURN_NONE;
}

static PyObject *
hostcallException(uint32_t state, uint32_t errorCode)
{
    if (state == PYPROC_HOSTCALL_TIMEOUT) {
        return PyProcHostTimeout;
    }
    if (state == PYPROC_HOSTCALL_CANCELLED) {
        return PyProcHostCancelled;
    }
    if (state == PYPROC_HOSTCALL_BROKER_LOST) {
        return PyProcHostBrokerLost;
    }
    if (state == PYPROC_HOSTCALL_OUTCOME_UNKNOWN) {
        return PyProcHostOutcomeUnknown;
    }
    if (errorCode == PYPROC_HOSTCALL_ERROR_DENIED) {
        return PyProcHostDenied;
    }
    if (errorCode == PYPROC_HOSTCALL_ERROR_OVERFLOW) {
        return PyProcHostOverflow;
    }
    return PyProcHostError;
}

static PyObject *
pyprocHostCall(PyObject *self, PyObject *args, PyObject *kwargs)
{
    static char *keywords[] = {
        "opcode", "payload", "flags", "deadline_ms", "response_capacity", NULL
    };
    unsigned int opcode;
    unsigned int flags = 0;
    unsigned int deadlineMs = 30000;
    unsigned int responseCapacity = 65536;
    Py_buffer payload = {0};
    unsigned char *request = NULL;
    unsigned char responseHeader[PYPROC_HOSTCALL_RESPONSE_HEADER];
    PyObject *response = NULL;
    PyObject *message = NULL;
    int fd = -1;
    uint32_t responseState;
    uint32_t responseLength;
    uint32_t errorCode;

    if (!PyArg_ParseTupleAndKeywords(args, kwargs, "I|y*III:call", keywords,
                                     &opcode, &payload, &flags, &deadlineMs,
                                     &responseCapacity)) {
        return NULL;
    }
    if (deadlineMs == 0 || payload.len < 0
        || (uint64_t)payload.len + responseCapacity > PYPROC_HOSTCALL_DATA_BYTES) {
        PyErr_SetString(PyProcHostOverflow,
                        "hostcall request and response exceed the shared record capacity");
        goto done;
    }
    request = PyMem_Malloc(PYPROC_HOSTCALL_REQUEST_HEADER + (size_t)payload.len);
    if (request == NULL) {
        PyErr_NoMemory();
        goto done;
    }
    pyprocHostRequestId += 1;
    if (pyprocHostRequestId == 0) {
        pyprocHostRequestId = 1;
    }
    writeU32(request, PYPROC_HOSTCALL_MAGIC);
    writeU32(request + 4, PYPROC_HOSTCALL_ABI);
    writeU32(request + 8, opcode);
    writeU32(request + 12, flags);
    writeU64(request + 16, pyprocHostRequestId);
    writeU32(request + 24, deadlineMs);
    writeU32(request + 28, (uint32_t)payload.len);
    writeU32(request + 32, responseCapacity);
    if (payload.len > 0) {
        memcpy(request + PYPROC_HOSTCALL_REQUEST_HEADER, payload.buf, (size_t)payload.len);
    }

    fd = open("/hostcall", O_RDWR);
    if (fd < 0 || writeAll(fd, request,
                            PYPROC_HOSTCALL_REQUEST_HEADER + (size_t)payload.len) < 0
        || readAll(fd, responseHeader, PYPROC_HOSTCALL_RESPONSE_HEADER) < 0) {
        PyErr_SetFromErrno(PyProcHostError);
        goto done;
    }
    if (readU32(responseHeader) != PYPROC_HOSTCALL_MAGIC
        || readU32(responseHeader + 4) != PYPROC_HOSTCALL_ABI) {
        PyErr_SetString(PyProcHostError, "hostcall response header is invalid");
        goto done;
    }
    responseState = readU32(responseHeader + 8);
    responseLength = readU32(responseHeader + 12);
    errorCode = readU32(responseHeader + 16);
    if (responseLength > responseCapacity) {
        PyErr_SetString(PyProcHostError, "hostcall response exceeds the declared capacity");
        goto done;
    }
    response = PyBytes_FromStringAndSize(NULL, responseLength);
    if (response == NULL) {
        goto done;
    }
    if (responseLength > 0
        && readAll(fd, (unsigned char *)PyBytes_AS_STRING(response), responseLength) < 0) {
        PyErr_SetFromErrno(PyProcHostError);
        goto done;
    }
    if (responseState == PYPROC_HOSTCALL_RESPONSE) {
        goto done;
    }
    message = PyUnicode_DecodeUTF8(PyBytes_AS_STRING(response), responseLength, "replace");
    if (message != NULL) {
        PyErr_SetObject(hostcallException(responseState, errorCode), message);
    }
    Py_CLEAR(response);

done:
    if (fd >= 0) {
        close(fd);
    }
    PyMem_Free(request);
    if (payload.obj != NULL) {
        PyBuffer_Release(&payload);
    }
    Py_XDECREF(message);
    return response;
}

static PyMethodDef pyprocHostMethods[] = {
    {"abiVersion", pyprocHostAbiVersion, METH_NOARGS,
     PyDoc_STR("Return the PyProc hostcall ABI version.")},
    {"noop", pyprocHostNoop, METH_NOARGS,
     PyDoc_STR("Complete a local host module no-op.")},
    {"call", _PyCFunction_CAST(pyprocHostCall), METH_VARARGS | METH_KEYWORDS,
     PyDoc_STR("Invoke a capability broker operation through pyproc.hostcall/1.")},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef pyprocHostModule = {
    PyModuleDef_HEAD_INIT,
    "_pyprocHost",
    PyDoc_STR("Static PyProc host integration module."),
    -1,
    pyprocHostMethods
};

static int
addException(PyObject *module, PyObject **target, const char *qualifiedName,
             const char *publicName, PyObject *base)
{
    *target = PyErr_NewException(qualifiedName, base, NULL);
    if (*target == NULL || PyModule_AddObjectRef(module, publicName, *target) < 0) {
        return -1;
    }
    return 0;
}

PyMODINIT_FUNC
PyInit__pyprocHost(void)
{
    PyObject *module = PyModule_Create(&pyprocHostModule);
    if (module == NULL) {
        return NULL;
    }
    if (addException(module, &PyProcHostError, "_pyprocHost.HostcallError",
                      "HostcallError", PyExc_RuntimeError) < 0
        || addException(module, &PyProcHostTimeout, "_pyprocHost.HostcallTimeout",
                         "HostcallTimeout", PyProcHostError) < 0
        || addException(module, &PyProcHostCancelled, "_pyprocHost.HostcallCancelled",
                         "HostcallCancelled", PyProcHostError) < 0
        || addException(module, &PyProcHostBrokerLost, "_pyprocHost.HostcallBrokerLost",
                         "HostcallBrokerLost", PyProcHostError) < 0
        || addException(module, &PyProcHostOutcomeUnknown, "_pyprocHost.HostcallOutcomeUnknown",
                         "HostcallOutcomeUnknown", PyProcHostError) < 0
        || addException(module, &PyProcHostDenied, "_pyprocHost.HostcallDenied",
                         "HostcallDenied", PyProcHostError) < 0
        || addException(module, &PyProcHostOverflow, "_pyprocHost.HostcallOverflow",
                         "HostcallOverflow", PyProcHostError) < 0) {
        Py_DECREF(module);
        return NULL;
    }
    return module;
}
