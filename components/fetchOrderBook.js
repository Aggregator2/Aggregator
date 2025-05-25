import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'http://localhost:3000/api/orders';

// Named export for the fetch function
export async function fetchOrderBook(apiUrl) {
    try {
        const res = await fetch(apiUrl, {
            headers: {
                'Authorization': 'Bearer ce875464-1d55-4097-830b-9f241b299fdb',
            },
        });

        if (!res.ok) {
            throw new Error(`API request failed with status ${res.status}: ${res.statusText}`);
        }

        return await res.json();
    } catch (err) {
        console.error('Error fetching order book:', err);
        throw err;
    }
}

// Default export for the component
function OrderBookComponent() {
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Use the correct backend API URL
                const API_URL = 'http://localhost:3000/api/orders';
                const data = await fetchOrderBook(API_URL);
                setOrders(data);
                setError(null);
            } catch (err) {
                setError(err.message);
            }
        };
        fetchData();
    }, []);

    return (
        <div>
            <h2>Order Book</h2>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {orders.length > 0 ? (
                <table>
                    <thead>
                        <tr>
                            <th>Maker</th>
                            <th>Taker</th>
                            <th>Amount</th>
                            <th>Price</th>
                            <th>Nonce</th>
                            <th>Expiry</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((order, index) => (
                            <tr key={index}>
                                <td>{order.maker}</td>
                                <td>{order.taker}</td>
                                <td>{order.amount}</td>
                                <td>{order.price}</td>
                                <td>{order.nonce}</td>
                                <td>{new Date(order.expiry * 1000).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                !error && <p>Loading orders...</p>
            )}
        </div>
    );
}

export default OrderBookComponent;
