import React, { useState, useEffect } from 'react';
import fetchOrderBook from './fetchOrderBook'; // Adjust the path if needed

const OrderBookComponent = () => {
    const [orders, setOrders] = useState([]); // State to store fetched orders
    const [error, setError] = useState(null); // State to store any errors

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const data = await fetchOrderBook(); // Call the fetchOrderBook function
                setOrders(data); // Update the orders state
                setError(null); // Clear any previous errors
            } catch (err) {
                console.error('❌ Error fetching order book:', err.message);
                setError('Failed to load order book. Please try again later.');
            }
        };

        // Fetch orders immediately and set up interval
        fetchOrders();
        const intervalId = setInterval(fetchOrders, 10000); // Fetch every 10 seconds

        // Cleanup interval on component unmount
        return () => clearInterval(intervalId);
    }, []); // Empty dependency array ensures this runs only once on mount

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
};

export default OrderBookComponent;