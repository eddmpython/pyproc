#define PY_SSIZE_T_CLEAN
#include <math.h>
#include <string.h>
#include <wasm_simd128.h>
#include "Python.h"

#ifndef __wasm_simd128__
#error "The data native profile requires WebAssembly SIMD"
#endif

static PyObject *pyproc_data_profile(PyObject *self, PyObject *Py_UNUSED(args)) {
    return PyUnicode_FromString("pyproc.data/2");
}

static PyObject *pyproc_data_simd(PyObject *self, PyObject *Py_UNUSED(args)) {
    return PyUnicode_FromString("wasm-simd128");
}

static int pyproc_data_pair(PyObject *args, PyObject **left, PyObject **right, Py_ssize_t *length) {
    PyObject *left_input = NULL;
    PyObject *right_input = NULL;
    if (!PyArg_ParseTuple(args, "OO", &left_input, &right_input)) {
        return -1;
    }
    *left = PySequence_Fast(left_input, "left operand must be a finite numeric sequence");
    if (*left == NULL) {
        return -1;
    }
    *right = PySequence_Fast(right_input, "right operand must be a finite numeric sequence");
    if (*right == NULL) {
        Py_DECREF(*left);
        *left = NULL;
        return -1;
    }
    *length = PySequence_Fast_GET_SIZE(*left);
    if (*length != PySequence_Fast_GET_SIZE(*right)) {
        PyErr_SetString(PyExc_ValueError, "numeric sequences must have the same length");
        Py_CLEAR(*left);
        Py_CLEAR(*right);
        return -1;
    }
    return 0;
}

static int pyproc_data_double(PyObject *value, double *result) {
    *result = PyFloat_AsDouble(value);
    if (*result == -1.0 && PyErr_Occurred()) {
        return -1;
    }
    if (!isfinite(*result)) {
        PyErr_SetString(PyExc_ValueError, "numeric sequences must contain only finite values");
        return -1;
    }
    return 0;
}

static PyObject *pyproc_data_vector_add(PyObject *self, PyObject *args) {
    PyObject *left = NULL;
    PyObject *right = NULL;
    Py_ssize_t length = 0;
    if (pyproc_data_pair(args, &left, &right, &length) < 0) {
        return NULL;
    }
    PyObject *result = PyList_New(length);
    if (result == NULL) {
        Py_DECREF(left);
        Py_DECREF(right);
        return NULL;
    }
    for (Py_ssize_t index = 0; index < length; index++) {
        double left_value = 0.0;
        double right_value = 0.0;
        if (pyproc_data_double(PySequence_Fast_GET_ITEM(left, index), &left_value) < 0
            || pyproc_data_double(PySequence_Fast_GET_ITEM(right, index), &right_value) < 0) {
            Py_DECREF(left);
            Py_DECREF(right);
            Py_DECREF(result);
            return NULL;
        }
        PyObject *item = PyFloat_FromDouble(left_value + right_value);
        if (item == NULL) {
            Py_DECREF(left);
            Py_DECREF(right);
            Py_DECREF(result);
            return NULL;
        }
        PyList_SET_ITEM(result, index, item);
    }
    Py_DECREF(left);
    Py_DECREF(right);
    return result;
}

static PyObject *pyproc_data_dot(PyObject *self, PyObject *args) {
    PyObject *left = NULL;
    PyObject *right = NULL;
    Py_ssize_t length = 0;
    if (pyproc_data_pair(args, &left, &right, &length) < 0) {
        return NULL;
    }
    double total = 0.0;
    for (Py_ssize_t index = 0; index < length; index++) {
        double left_value = 0.0;
        double right_value = 0.0;
        if (pyproc_data_double(PySequence_Fast_GET_ITEM(left, index), &left_value) < 0
            || pyproc_data_double(PySequence_Fast_GET_ITEM(right, index), &right_value) < 0) {
            Py_DECREF(left);
            Py_DECREF(right);
            return NULL;
        }
        total += left_value * right_value;
        if (!isfinite(total)) {
            Py_DECREF(left);
            Py_DECREF(right);
            PyErr_SetString(PyExc_OverflowError, "dot product exceeded finite range");
            return NULL;
        }
    }
    Py_DECREF(left);
    Py_DECREF(right);
    return PyFloat_FromDouble(total);
}

static int pyproc_data_buffer_pair(
    PyObject *args,
    Py_buffer *left,
    Py_buffer *right,
    Py_ssize_t *length
) {
    PyObject *left_input = NULL;
    PyObject *right_input = NULL;
    if (!PyArg_ParseTuple(args, "OO", &left_input, &right_input)) {
        return -1;
    }
    if (PyObject_GetBuffer(left_input, left, PyBUF_CONTIG_RO | PyBUF_FORMAT) < 0) {
        return -1;
    }
    if (PyObject_GetBuffer(right_input, right, PyBUF_CONTIG_RO | PyBUF_FORMAT) < 0) {
        PyBuffer_Release(left);
        return -1;
    }
    if (left->itemsize != (Py_ssize_t)sizeof(double)
        || right->itemsize != (Py_ssize_t)sizeof(double)
        || left->format == NULL || right->format == NULL
        || strcmp(left->format, "d") != 0 || strcmp(right->format, "d") != 0
        || left->len % (Py_ssize_t)sizeof(double) != 0
        || right->len % (Py_ssize_t)sizeof(double) != 0) {
        PyBuffer_Release(left);
        PyBuffer_Release(right);
        PyErr_SetString(PyExc_TypeError, "operands must be contiguous native float64 buffers");
        return -1;
    }
    if (left->len != right->len) {
        PyBuffer_Release(left);
        PyBuffer_Release(right);
        PyErr_SetString(PyExc_ValueError, "float64 buffers must have the same length");
        return -1;
    }
    *length = left->len / (Py_ssize_t)sizeof(double);
    return 0;
}

static int pyproc_data_finite_lane(v128_t value, int lane) {
    double item = lane == 0
        ? wasm_f64x2_extract_lane(value, 0)
        : wasm_f64x2_extract_lane(value, 1);
    if (!isfinite(item)) {
        PyErr_SetString(PyExc_ValueError, "float64 buffers must contain only finite values");
        return -1;
    }
    return 0;
}

static PyObject *pyproc_data_vector_add_f64(PyObject *self, PyObject *args) {
    Py_buffer left = {0};
    Py_buffer right = {0};
    Py_ssize_t length = 0;
    if (pyproc_data_buffer_pair(args, &left, &right, &length) < 0) {
        return NULL;
    }
    PyObject *result = PyBytes_FromStringAndSize(NULL, left.len);
    if (result == NULL) {
        PyBuffer_Release(&left);
        PyBuffer_Release(&right);
        return NULL;
    }
    const unsigned char *left_bytes = left.buf;
    const unsigned char *right_bytes = right.buf;
    unsigned char *result_bytes = (unsigned char *)PyBytes_AS_STRING(result);
    Py_ssize_t index = 0;
    for (; index + 1 < length; index += 2) {
        Py_ssize_t offset = index * (Py_ssize_t)sizeof(double);
        v128_t left_values = wasm_v128_load(left_bytes + offset);
        v128_t right_values = wasm_v128_load(right_bytes + offset);
        if (pyproc_data_finite_lane(left_values, 0) < 0
            || pyproc_data_finite_lane(left_values, 1) < 0
            || pyproc_data_finite_lane(right_values, 0) < 0
            || pyproc_data_finite_lane(right_values, 1) < 0) {
            goto error;
        }
        v128_t added = wasm_f64x2_add(left_values, right_values);
        if (!isfinite(wasm_f64x2_extract_lane(added, 0))
            || !isfinite(wasm_f64x2_extract_lane(added, 1))) {
            PyErr_SetString(PyExc_OverflowError, "vector addition exceeded finite range");
            goto error;
        }
        wasm_v128_store(result_bytes + offset, added);
    }
    if (index < length) {
        Py_ssize_t offset = index * (Py_ssize_t)sizeof(double);
        double left_value = 0.0;
        double right_value = 0.0;
        memcpy(&left_value, left_bytes + offset, sizeof(double));
        memcpy(&right_value, right_bytes + offset, sizeof(double));
        double added = left_value + right_value;
        if (!isfinite(left_value) || !isfinite(right_value)) {
            PyErr_SetString(PyExc_ValueError, "float64 buffers must contain only finite values");
            goto error;
        }
        if (!isfinite(added)) {
            PyErr_SetString(PyExc_OverflowError, "vector addition exceeded finite range");
            goto error;
        }
        memcpy(result_bytes + offset, &added, sizeof(double));
    }
    PyBuffer_Release(&left);
    PyBuffer_Release(&right);
    return result;

error:
    PyBuffer_Release(&left);
    PyBuffer_Release(&right);
    Py_DECREF(result);
    return NULL;
}

static PyObject *pyproc_data_dot_f64(PyObject *self, PyObject *args) {
    Py_buffer left = {0};
    Py_buffer right = {0};
    Py_ssize_t length = 0;
    if (pyproc_data_buffer_pair(args, &left, &right, &length) < 0) {
        return NULL;
    }
    const unsigned char *left_bytes = left.buf;
    const unsigned char *right_bytes = right.buf;
    v128_t accumulator = wasm_f64x2_splat(0.0);
    Py_ssize_t index = 0;
    for (; index + 1 < length; index += 2) {
        Py_ssize_t offset = index * (Py_ssize_t)sizeof(double);
        v128_t left_values = wasm_v128_load(left_bytes + offset);
        v128_t right_values = wasm_v128_load(right_bytes + offset);
        if (pyproc_data_finite_lane(left_values, 0) < 0
            || pyproc_data_finite_lane(left_values, 1) < 0
            || pyproc_data_finite_lane(right_values, 0) < 0
            || pyproc_data_finite_lane(right_values, 1) < 0) {
            goto error;
        }
        v128_t products = wasm_f64x2_mul(left_values, right_values);
        accumulator = wasm_f64x2_add(accumulator, products);
        if (!isfinite(wasm_f64x2_extract_lane(products, 0))
            || !isfinite(wasm_f64x2_extract_lane(products, 1))
            || !isfinite(wasm_f64x2_extract_lane(accumulator, 0))
            || !isfinite(wasm_f64x2_extract_lane(accumulator, 1))) {
            PyErr_SetString(PyExc_OverflowError, "dot product exceeded finite range");
            goto error;
        }
    }
    double total = wasm_f64x2_extract_lane(accumulator, 0)
        + wasm_f64x2_extract_lane(accumulator, 1);
    if (index < length) {
        Py_ssize_t offset = index * (Py_ssize_t)sizeof(double);
        double left_value = 0.0;
        double right_value = 0.0;
        memcpy(&left_value, left_bytes + offset, sizeof(double));
        memcpy(&right_value, right_bytes + offset, sizeof(double));
        if (!isfinite(left_value) || !isfinite(right_value)) {
            PyErr_SetString(PyExc_ValueError, "float64 buffers must contain only finite values");
            goto error;
        }
        total += left_value * right_value;
    }
    if (!isfinite(total)) {
        PyErr_SetString(PyExc_OverflowError, "dot product exceeded finite range");
        goto error;
    }
    PyBuffer_Release(&left);
    PyBuffer_Release(&right);
    return PyFloat_FromDouble(total);

error:
    PyBuffer_Release(&left);
    PyBuffer_Release(&right);
    return NULL;
}

static PyMethodDef pyproc_data_methods[] = {
    {"profile", pyproc_data_profile, METH_NOARGS, "Return the static native profile ABI."},
    {"simd", pyproc_data_simd, METH_NOARGS, "Return the compiled SIMD implementation identity."},
    {"vector_add", pyproc_data_vector_add, METH_VARARGS, "Add two finite numeric sequences."},
    {"dot", pyproc_data_dot, METH_VARARGS, "Return the finite dot product of two numeric sequences."},
    {"vector_add_f64", pyproc_data_vector_add_f64, METH_VARARGS, "Add two contiguous float64 buffers with SIMD."},
    {"dot_f64", pyproc_data_dot_f64, METH_VARARGS, "Return a SIMD dot product for two float64 buffers."},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef pyproc_data_module = {
    PyModuleDef_HEAD_INIT,
    "_pyprocData",
    "PyProc owned static data profile probe.",
    -1,
    pyproc_data_methods
};

PyMODINIT_FUNC PyInit__pyprocData(void) {
    return PyModule_Create(&pyproc_data_module);
}
