from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="offchain-protocol",
    version="1.0.0",
    author="Offchain Protocol",
    author_email="sdk@offchain.finance",
    description="Python SDK for Offchain Protocol API",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/offchain-protocol/python-sdk",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 5 - Production/Stable",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.7",
    install_requires=[
        "aiohttp>=3.8.0",
        "websockets>=10.0",
        "pydantic>=2.0.0",
        "python-dateutil>=2.8.0",
        "typing-extensions>=4.0.0;python_version<'3.8'",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-asyncio>=0.20.0",
            "pytest-cov>=4.0.0",
            "black>=22.0.0",
            "mypy>=1.0.0",
            "flake8>=5.0.0",
            "sphinx>=5.0.0",
            "sphinx-rtd-theme>=1.0.0",
        ]
    },
    package_data={
        "offchain_protocol": ["py.typed"],
    },
)