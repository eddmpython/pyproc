#define PY_SSIZE_T_CLEAN
#include <math.h>
#include "Python.h"

static PyObject *pyproc_data_profile(PyObject *self, PyObject *Py_UNUSED(args)) {
    return PyUnicode_FromString("pyproc.data/1");
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

static PyMethodDef pyproc_data_methods[] = {
    {"profile", pyproc_data_profile, METH_NOARGS, "Return the static native profile ABI."},
    {"vector_add", pyproc_data_vector_add, METH_VARARGS, "Add two finite numeric sequences."},
    {"dot", pyproc_data_dot, METH_VARARGS, "Return the finite dot product of two numeric sequences."},
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
