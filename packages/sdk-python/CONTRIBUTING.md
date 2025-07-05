# Contributing to Offchain Protocol Python SDK

We welcome contributions to the Offchain Protocol Python SDK! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Python 3.8 or higher
- pip and virtualenv (or poetry)
- Git

### Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/offchain-sdk-python.git
   cd offchain-sdk-python
   ```

3. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

4. Install dependencies:
   ```bash
   pip install -e ".[dev]"
   ```

5. Run tests:
   ```bash
   pytest
   ```

## Development Workflow

### Code Style

We use Black for code formatting, isort for import sorting, and flake8 for linting:

```bash
# Format code
black offchain_protocol/

# Sort imports
isort offchain_protocol/

# Run linter
flake8 offchain_protocol/

# Type checking
mypy offchain_protocol/
```

Or run all at once:
```bash
make lint
```

### Testing

All code changes should include tests. We use pytest:

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=offchain_protocol

# Run specific test file
pytest tests/test_client.py

# Run tests matching pattern
pytest -k "test_create_order"
```

### Type Hints

Always use type hints:

```python
# Good
async def get_order(self, order_id: str) -> Order:
    ...

# Bad
async def get_order(self, order_id):
    ...
```

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Add tests for any new functionality
3. Ensure all tests pass
4. Update the documentation
5. Create a Pull Request with a clear title and description

### Commit Messages

Follow the conventional commits specification:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc)
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Build process or auxiliary tool changes

Examples:
```
feat: add support for stop-limit orders
fix: handle rate limit errors in websocket client
docs: update examples for new order types
```

## Code Guidelines

### Error Handling

Always use specific exception types:

```python
from offchain_protocol.exceptions import ValidationError, OrderNotFoundError

# Good
if not order:
    raise OrderNotFoundError(order_id)

# Bad
if not order:
    raise Exception("Order not found")
```

### Async/Await

Always use async/await for I/O operations:

```python
# Good
async def fetch_data(self) -> dict:
    async with self.session.get(url) as response:
        return await response.json()

# Bad
def fetch_data(self):
    return requests.get(url).json()
```

### Type Safety with Pydantic

Use Pydantic models for data validation:

```python
# Good
class Order(BaseModel):
    id: str
    pair: str
    price: Decimal
    quantity: Decimal
    
    class Config:
        populate_by_name = True

# Bad
class Order:
    def __init__(self, data):
        self.id = data.get('id')
        self.pair = data.get('pair')
        # etc...
```

## Testing Guidelines

### Unit Tests

```python
import pytest
from offchain_protocol import OffchainClient, CreateOrderRequest, OrderSide, OrderType

@pytest.mark.asyncio
async def test_create_order():
    async with OffchainClient('test-key', testnet=True) as client:
        order = await client.create_order(CreateOrderRequest(
            pair='BTC/USDT',
            side=OrderSide.BUY,
            type=OrderType.LIMIT,
            quantity='0.1',
            price='45000'
        ))
        
        assert order.id is not None
        assert order.status == OrderStatus.OPEN
```

### Mocking External APIs

```python
from aioresponses import aioresponses

@pytest.mark.asyncio
async def test_get_order_with_mock():
    with aioresponses() as mocked:
        mocked.get(
            'https://api.testnet.offchain.finance/orders/123',
            payload={'data': {'id': '123', 'status': 'open'}}
        )
        
        async with OffchainClient('test-key', testnet=True) as client:
            order = await client.get_order('123')
            assert order.id == '123'
```

### WebSocket Tests

```python
@pytest.mark.asyncio
async def test_websocket_streaming():
    async with OffchainClient('test-key', testnet=True) as client:
        trades = []
        async for trade in client.stream_trades('BTC/USDT'):
            trades.append(trade)
            if len(trades) >= 5:
                break
        
        assert len(trades) == 5
        assert all(t.pair == 'BTC/USDT' for t in trades)
```

## Documentation

### Docstrings

Use Google-style docstrings:

```python
async def create_order(self, request: CreateOrderRequest) -> Order:
    """Create a new order.
    
    Args:
        request: The order creation request containing pair, side, type,
            quantity, and price information.
    
    Returns:
        The created order with ID and status.
    
    Raises:
        ValidationError: If the order parameters are invalid.
        InsufficientBalanceError: If the user has insufficient balance.
        
    Example:
        >>> order = await client.create_order(CreateOrderRequest(
        ...     pair='BTC/USDT',
        ...     side=OrderSide.BUY,
        ...     type=OrderType.LIMIT,
        ...     quantity='0.1',
        ...     price='45000'
        ... ))
    """
```

### Type Stubs

Ensure all public APIs have proper type hints for IDE support.

## Performance Guidelines

### Connection Pooling

Use aiohttp session for connection pooling:

```python
# Good - reuse session
async with aiohttp.ClientSession() as session:
    for i in range(100):
        await session.get(url)

# Bad - create new session each time
for i in range(100):
    async with aiohttp.ClientSession() as session:
        await session.get(url)
```

### Concurrent Operations

Use asyncio.gather for concurrent operations:

```python
# Good
orders = await asyncio.gather(
    client.get_order('123'),
    client.get_order('456'),
    client.get_order('789')
)

# Bad
orders = []
orders.append(await client.get_order('123'))
orders.append(await client.get_order('456'))
orders.append(await client.get_order('789'))
```

## Release Process

1. Update version in setup.py and __init__.py
2. Update CHANGELOG.md
3. Create a git tag
4. Push to GitHub
5. GitHub Actions will automatically publish to PyPI

## Running Examples

```bash
# Set up environment
export OFFCHAIN_API_KEY="your-api-key"

# Run examples
python examples/quickstart.py
python examples/market_maker.py
python examples/dca_bot.py
```

## Questions?

Feel free to open an issue or reach out to the maintainers:

- GitHub Issues: https://github.com/offchain-protocol/sdk-python/issues
- Discord: https://discord.gg/offchain
- Email: sdk@offchain.finance