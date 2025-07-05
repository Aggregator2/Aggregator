.PHONY: help install install-dev test test-cov lint format type-check clean build publish

help:
	@echo "Available commands:"
	@echo "  install      Install package dependencies"
	@echo "  install-dev  Install package with development dependencies"
	@echo "  test         Run tests"
	@echo "  test-cov     Run tests with coverage"
	@echo "  lint         Run linters (black, isort, flake8)"
	@echo "  format       Format code with black and isort"
	@echo "  type-check   Run mypy type checking"
	@echo "  clean        Clean build artifacts"
	@echo "  build        Build distribution packages"
	@echo "  publish      Publish to PyPI"

install:
	pip install -e .

install-dev:
	pip install -e ".[dev]"

test:
	pytest

test-cov:
	pytest --cov=offchain_protocol --cov-report=html --cov-report=term

lint:
	black --check offchain_protocol/ tests/
	isort --check-only offchain_protocol/ tests/
	flake8 offchain_protocol/ tests/
	mypy offchain_protocol/

format:
	black offchain_protocol/ tests/
	isort offchain_protocol/ tests/

type-check:
	mypy offchain_protocol/

clean:
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info
	rm -rf .coverage
	rm -rf htmlcov/
	rm -rf .pytest_cache/
	rm -rf .mypy_cache/
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

build: clean
	python setup.py sdist bdist_wheel

publish: build
	twine upload dist/*