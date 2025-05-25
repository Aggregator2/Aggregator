/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "pages/_app";
exports.ids = ["pages/_app"];
exports.modules = {

/***/ "(pages-dir-node)/./components/globals.css":
/*!********************************!*\
  !*** ./components/globals.css ***!
  \********************************/
/***/ (() => {



/***/ }),

/***/ "(pages-dir-node)/./components/homepage.js":
/*!********************************!*\
  !*** ./components/homepage.js ***!
  \********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"react/jsx-dev-runtime\");\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_1__);\n\n\nconst Homepage = ()=>{\n    const [result, setResult] = (0,react__WEBPACK_IMPORTED_MODULE_1__.useState)('');\n    const handleSubmit = async (event)=>{\n        event.preventDefault();\n        const jsonInput = document.getElementById('jsonInput').value;\n        try {\n            const jsonData = JSON.parse(jsonInput);\n            setResult('⏳ Sending request...');\n            const response = await fetch('/api/submit', {\n                method: 'POST',\n                headers: {\n                    'Content-Type': 'application/json'\n                },\n                body: JSON.stringify(jsonData)\n            });\n            if (response.ok) {\n                setResult('✅ Order submitted successfully');\n            } else {\n                setResult('❌ Error submitting order');\n            }\n        } catch (error) {\n            setResult('❌ Invalid JSON. Please check your input.');\n        }\n    };\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"div\", {\n        children: [\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"form\", {\n                onSubmit: handleSubmit,\n                children: [\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"textarea\", {\n                        id: \"jsonInput\",\n                        rows: \"10\",\n                        placeholder: '{\"key\": \"value\"}'\n                    }, void 0, false, {\n                        fileName: \"C:\\\\Users\\\\joeri\\\\OneDrive\\\\Desktop\\\\Meta Aggregator 2.0\\\\components\\\\homepage.js\",\n                        lineNumber: 32,\n                        columnNumber: 9\n                    }, undefined),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"button\", {\n                        type: \"submit\",\n                        children: \"Submit\"\n                    }, void 0, false, {\n                        fileName: \"C:\\\\Users\\\\joeri\\\\OneDrive\\\\Desktop\\\\Meta Aggregator 2.0\\\\components\\\\homepage.js\",\n                        lineNumber: 33,\n                        columnNumber: 9\n                    }, undefined)\n                ]\n            }, void 0, true, {\n                fileName: \"C:\\\\Users\\\\joeri\\\\OneDrive\\\\Desktop\\\\Meta Aggregator 2.0\\\\components\\\\homepage.js\",\n                lineNumber: 31,\n                columnNumber: 7\n            }, undefined),\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"div\", {\n                children: result\n            }, void 0, false, {\n                fileName: \"C:\\\\Users\\\\joeri\\\\OneDrive\\\\Desktop\\\\Meta Aggregator 2.0\\\\components\\\\homepage.js\",\n                lineNumber: 35,\n                columnNumber: 7\n            }, undefined)\n        ]\n    }, void 0, true, {\n        fileName: \"C:\\\\Users\\\\joeri\\\\OneDrive\\\\Desktop\\\\Meta Aggregator 2.0\\\\components\\\\homepage.js\",\n        lineNumber: 30,\n        columnNumber: 5\n    }, undefined);\n};\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Homepage);\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHBhZ2VzLWRpci1ub2RlKS8uL2NvbXBvbmVudHMvaG9tZXBhZ2UuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQXdDO0FBRXhDLE1BQU1FLFdBQVc7SUFDZixNQUFNLENBQUNDLFFBQVFDLFVBQVUsR0FBR0gsK0NBQVFBLENBQUM7SUFFckMsTUFBTUksZUFBZSxPQUFPQztRQUMxQkEsTUFBTUMsY0FBYztRQUNwQixNQUFNQyxZQUFZQyxTQUFTQyxjQUFjLENBQUMsYUFBYUMsS0FBSztRQUU1RCxJQUFJO1lBQ0YsTUFBTUMsV0FBV0MsS0FBS0MsS0FBSyxDQUFDTjtZQUM1QkosVUFBVTtZQUNWLE1BQU1XLFdBQVcsTUFBTUMsTUFBTSxlQUFlO2dCQUMxQ0MsUUFBUTtnQkFDUkMsU0FBUztvQkFBRSxnQkFBZ0I7Z0JBQW1CO2dCQUM5Q0MsTUFBTU4sS0FBS08sU0FBUyxDQUFDUjtZQUN2QjtZQUVBLElBQUlHLFNBQVNNLEVBQUUsRUFBRTtnQkFDZmpCLFVBQVU7WUFDWixPQUFPO2dCQUNMQSxVQUFVO1lBQ1o7UUFDRixFQUFFLE9BQU9rQixPQUFPO1lBQ2RsQixVQUFVO1FBQ1o7SUFDRjtJQUVBLHFCQUNFLDhEQUFDbUI7OzBCQUNDLDhEQUFDQztnQkFBS0MsVUFBVXBCOztrQ0FDZCw4REFBQ3FCO3dCQUFTQyxJQUFHO3dCQUFZQyxNQUFLO3dCQUFLQyxhQUFZOzs7Ozs7a0NBQy9DLDhEQUFDQzt3QkFBT0MsTUFBSztrQ0FBUzs7Ozs7Ozs7Ozs7OzBCQUV4Qiw4REFBQ1I7MEJBQUtwQjs7Ozs7Ozs7Ozs7O0FBR1o7QUFFQSxpRUFBZUQsUUFBUUEsRUFBQyIsInNvdXJjZXMiOlsiQzpcXFVzZXJzXFxqb2VyaVxcT25lRHJpdmVcXERlc2t0b3BcXE1ldGEgQWdncmVnYXRvciAyLjBcXGNvbXBvbmVudHNcXGhvbWVwYWdlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBSZWFjdCwgeyB1c2VTdGF0ZSB9IGZyb20gJ3JlYWN0JztcclxuXHJcbmNvbnN0IEhvbWVwYWdlID0gKCkgPT4ge1xyXG4gIGNvbnN0IFtyZXN1bHQsIHNldFJlc3VsdF0gPSB1c2VTdGF0ZSgnJyk7XHJcblxyXG4gIGNvbnN0IGhhbmRsZVN1Ym1pdCA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgIGNvbnN0IGpzb25JbnB1dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdqc29uSW5wdXQnKS52YWx1ZTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBqc29uRGF0YSA9IEpTT04ucGFyc2UoanNvbklucHV0KTtcclxuICAgICAgc2V0UmVzdWx0KCfij7MgU2VuZGluZyByZXF1ZXN0Li4uJyk7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goJy9hcGkvc3VibWl0Jywge1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGpzb25EYXRhKSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAocmVzcG9uc2Uub2spIHtcclxuICAgICAgICBzZXRSZXN1bHQoJ+KchSBPcmRlciBzdWJtaXR0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc2V0UmVzdWx0KCfinYwgRXJyb3Igc3VibWl0dGluZyBvcmRlcicpO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBzZXRSZXN1bHQoJ+KdjCBJbnZhbGlkIEpTT04uIFBsZWFzZSBjaGVjayB5b3VyIGlucHV0LicpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIHJldHVybiAoXHJcbiAgICA8ZGl2PlxyXG4gICAgICA8Zm9ybSBvblN1Ym1pdD17aGFuZGxlU3VibWl0fT5cclxuICAgICAgICA8dGV4dGFyZWEgaWQ9XCJqc29uSW5wdXRcIiByb3dzPVwiMTBcIiBwbGFjZWhvbGRlcj0ne1wia2V5XCI6IFwidmFsdWVcIn0nPjwvdGV4dGFyZWE+XHJcbiAgICAgICAgPGJ1dHRvbiB0eXBlPVwic3VibWl0XCI+U3VibWl0PC9idXR0b24+XHJcbiAgICAgIDwvZm9ybT5cclxuICAgICAgPGRpdj57cmVzdWx0fTwvZGl2PlxyXG4gICAgPC9kaXY+XHJcbiAgKTtcclxufTtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IEhvbWVwYWdlOyJdLCJuYW1lcyI6WyJSZWFjdCIsInVzZVN0YXRlIiwiSG9tZXBhZ2UiLCJyZXN1bHQiLCJzZXRSZXN1bHQiLCJoYW5kbGVTdWJtaXQiLCJldmVudCIsInByZXZlbnREZWZhdWx0IiwianNvbklucHV0IiwiZG9jdW1lbnQiLCJnZXRFbGVtZW50QnlJZCIsInZhbHVlIiwianNvbkRhdGEiLCJKU09OIiwicGFyc2UiLCJyZXNwb25zZSIsImZldGNoIiwibWV0aG9kIiwiaGVhZGVycyIsImJvZHkiLCJzdHJpbmdpZnkiLCJvayIsImVycm9yIiwiZGl2IiwiZm9ybSIsIm9uU3VibWl0IiwidGV4dGFyZWEiLCJpZCIsInJvd3MiLCJwbGFjZWhvbGRlciIsImJ1dHRvbiIsInR5cGUiXSwiaWdub3JlTGlzdCI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(pages-dir-node)/./components/homepage.js\n");

/***/ }),

/***/ "(pages-dir-node)/./components/public/styles.css":
/*!**************************************!*\
  !*** ./components/public/styles.css ***!
  \**************************************/
/***/ (() => {



/***/ }),

/***/ "(pages-dir-node)/./pages/_app.js":
/*!***********************!*\
  !*** ./pages/_app.js ***!
  \***********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ App)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"react/jsx-dev-runtime\");\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _components_globals_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../components/globals.css */ \"(pages-dir-node)/./components/globals.css\");\n/* harmony import */ var _components_globals_css__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_components_globals_css__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _components_public_styles_css__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../components/public/styles.css */ \"(pages-dir-node)/./components/public/styles.css\");\n/* harmony import */ var _components_public_styles_css__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_components_public_styles_css__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var _components_homepage_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../components/homepage.js */ \"(pages-dir-node)/./components/homepage.js\");\n\n // Tailwind/global styles\n // Your custom global CSS (if needed)\n // Your custom global CSS (if needed)\nfunction App({ Component, pageProps }) {\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(Component, {\n        ...pageProps\n    }, void 0, false, {\n        fileName: \"C:\\\\Users\\\\joeri\\\\OneDrive\\\\Desktop\\\\Meta Aggregator 2.0\\\\pages\\\\_app.js\",\n        lineNumber: 6,\n        columnNumber: 10\n    }, this);\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHBhZ2VzLWRpci1ub2RlKS8uL3BhZ2VzL19hcHAuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQW1DLENBQUMseUJBQXlCO0FBQ3BCLENBQUMscUNBQXFDO0FBQzVDLENBQUMscUNBQXFDO0FBRTFELFNBQVNBLElBQUksRUFBRUMsU0FBUyxFQUFFQyxTQUFTLEVBQUU7SUFDbEQscUJBQU8sOERBQUNEO1FBQVcsR0FBR0MsU0FBUzs7Ozs7O0FBQ2pDIiwic291cmNlcyI6WyJDOlxcVXNlcnNcXGpvZXJpXFxPbmVEcml2ZVxcRGVza3RvcFxcTWV0YSBBZ2dyZWdhdG9yIDIuMFxccGFnZXNcXF9hcHAuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICcuLi9jb21wb25lbnRzL2dsb2JhbHMuY3NzJzsgLy8gVGFpbHdpbmQvZ2xvYmFsIHN0eWxlc1xyXG5pbXBvcnQgJy4uL2NvbXBvbmVudHMvcHVibGljL3N0eWxlcy5jc3MnOyAvLyBZb3VyIGN1c3RvbSBnbG9iYWwgQ1NTIChpZiBuZWVkZWQpXHJcbmltcG9ydCAnLi4vY29tcG9uZW50cy9ob21lcGFnZS5qcyc7IC8vIFlvdXIgY3VzdG9tIGdsb2JhbCBDU1MgKGlmIG5lZWRlZClcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEFwcCh7IENvbXBvbmVudCwgcGFnZVByb3BzIH0pIHtcclxuICByZXR1cm4gPENvbXBvbmVudCB7Li4ucGFnZVByb3BzfSAvPjtcclxufSJdLCJuYW1lcyI6WyJBcHAiLCJDb21wb25lbnQiLCJwYWdlUHJvcHMiXSwiaWdub3JlTGlzdCI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(pages-dir-node)/./pages/_app.js\n");

/***/ }),

/***/ "react":
/*!************************!*\
  !*** external "react" ***!
  \************************/
/***/ ((module) => {

"use strict";
module.exports = require("react");

/***/ }),

/***/ "react/jsx-dev-runtime":
/*!****************************************!*\
  !*** external "react/jsx-dev-runtime" ***!
  \****************************************/
/***/ ((module) => {

"use strict";
module.exports = require("react/jsx-dev-runtime");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("(pages-dir-node)/./pages/_app.js"));
module.exports = __webpack_exports__;

})();