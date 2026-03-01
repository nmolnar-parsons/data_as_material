// Use d3 to load prepared CSV, create visualization, and export


// Dimensions

    // Poster is  18x24 inches, which is a 3:4 aspect ratio. 
const viz_dimensions = {
    width: 900,
    height: 1200,
    margin: {
        top: 100,
        right: 200,
        bottom: 100,
        left: 200
    }
}

// Create SVG canvas
const svg = d3.select("#viz")
    .append("svg")
    .attr("width", viz_dimensions.width)
    .attr("height", viz_dimensions.height)
    // center the SVG in the container
    .style("display", "block")
    .style("margin", "0 auto")
    .style("background-color", "#f9f9f9"); // light background for better contrast

// Load prepared CSV data
d3.csv("nosetouch_data_prepared.csv").then(data => {
    console.log(data); // Check the loaded data
    

    // //Group data at the hour level
    // data.forEach(d => {
    //     d.datetime = new Date(d.datetime);
    //     d.hour = d3.timeHour(d.datetime); // Group by hour
    // });
    // console.log(data); // Check the data with hour grouping

    // // use hour for x-axis
    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.hour))
        .range([viz_dimensions.margin.left, viz_dimensions.width - viz_dimensions.margin.right]);

    // //alterantive x: using a lienar scale based 

    const y = d3.scaleOrdinal()
        .domain(["0", "1"])
        .range([viz_dimensions.height * 0.55, viz_dimensions.height * 0.45]); // Position at 30% and 70% of height



    // // //add jitter to y position to avoid overlap
    // // const jitter = 20;

    // // // Add points to the SVG
    // // svg.selectAll("circle")
    // //     .data(data)
    // //     .enter()
    // //     .append("circle")
    // //     .attr("cx", d => x(new Date(d.datetime)))
    // //     .attr("cy", d => y(d.side) + (Math.random() - 0.5) * jitter) // Add jitter to y position
    // //     .attr("r", 5)
    // //     .attr("fill", d => d.side === "0" ? "steelblue" : "coral");

    // // //draw x-axis
    // // const xAxis = d3.axisBottom(x)
    // //     // .ticks(d3.timeHour.every(1)) // Adjust ticks to every hour
    // //     // .tickFormat(d3.timeFormat("%H:%M")); // Format ticks as HH:MM

    // // svg.append("g")
    // //     .attr("transform", `translate(0, ${0.5*viz_dimensions.height})`)
    // //     .call(xAxis);

    // // new stuff here

    // // Group data by hour and side to stack overlapping points
    // const grouped = d3.group(data, d => `${d.hour.getTime()}-${d.side}`);
    
    // const stackOffset = 20; // Vertical offset between stacked points
    
    // // Add stacking index to each point
    // grouped.forEach(group => {
    //     group.forEach((d, i) => {
    //         d.stackIndex = i;
    //     });
    // });

    // // Add points to the SVG
    // svg.selectAll("circle")
    //     .data(data)
    //     .enter()
    //     .append("circle")
    //     .attr("cx", d => x(d.hour))
    //     .attr("cy", d => y(d.side) + (d.stackIndex * stackOffset)) // Stack overlapping points
    //     .attr("r", 5)
    //     .attr("fill", d => {
    //         if (d.side === "Right") return "red";      // Left is red
    //         if (d.side === "Left") return "blue";     // Right is blue
    //         return "purple";                        // N/A is purple
    //     })
    //     .attr("opacity", 0.7); // Slightly transparent for better visibility

    //diagonal data

    data.forEach(d => {
        d.datetime = new Date(d.datetime);
        d.hour = d3.timeHour(d.datetime); // Group by hour
    });
    console.log(data); // Check the data with hour grouping

    // Create a scale for position along the diagonal
    const diagonalScale = d3.scaleTime()
        .domain(d3.extent(data, d => d.hour))
        .range([0, 1]); // 0 = bottom-left, 1 = top-right

    // Calculate x,y position along diagonal based on time
    const getDiagonalX = (d) => {
        const t = diagonalScale(d.hour);
        return viz_dimensions.margin.left + t * (viz_dimensions.width - viz_dimensions.margin.left - viz_dimensions.margin.right);
    };

    const getDiagonalY = (d) => {
        const t = diagonalScale(d.hour);
        return (viz_dimensions.height - viz_dimensions.margin.bottom) - t * (viz_dimensions.height - viz_dimensions.margin.top - viz_dimensions.margin.bottom);
    };

    // Offset perpendicular to diagonal for left/right sides
    const perpendicularOffset = 50; // Distance from diagonal line
    const angle = Math.atan2(
        viz_dimensions.margin.top - (viz_dimensions.height - viz_dimensions.margin.bottom),
        (viz_dimensions.width - viz_dimensions.margin.right) - viz_dimensions.margin.left
    );

    // Create color scale for location
    const locationColors = d3.scaleOrdinal()
        .domain(["Home", "School", "Commute", "Gym", "Meal", "Brother's apartment", "Party"])
        .range(["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628"]);
    
    // Create shape generator for part_of_body
    const bodyPartSymbol = d3.scaleOrdinal()
        .domain(["Hand", "Sleeve", "Shoulder", "Glasses", "Whole Ass Arm"])
        .range([d3.symbolCircle, d3.symbolSquare, d3.symbolTriangle, d3.symbolDiamond, d3.symbolStar]);
    
    // Create size scale for number_of_times
    const sizeScale = d3.scaleLinear()
        .domain([1, d3.max(data, d => +d.number_of_times)])
        .range([100, 300]); // Size in square pixels for d3.symbol
    
    // Group data by hour and side to stack overlapping points
    const grouped = d3.group(data, d => `${d.hour.getTime()}-${d.side}`);
    
    const stackOffset = 20; // Vertical offset between stacked points
    const jitter = 5; // add slight jitter to all points
    
    // Add stacking index to each point
    grouped.forEach(group => {
        group.forEach((d, i) => {
            d.stackIndex = i;
            d.jitterX = (Math.random() - 0.5) * jitter;
            d.jitterY = (Math.random() - 0.5) * jitter;
        });
    });

    // Add points to the SVG using path elements for different shapes
    svg.selectAll("path.datapoint")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "datapoint")
        .attr("d", d => {
            const symbolType = bodyPartSymbol(d.part_of_body) || d3.symbolCircle;
            const symbolSize = sizeScale(+d.number_of_times);
            return d3.symbol().type(symbolType).size(symbolSize)();
        })
        .attr("transform", d => {
            const baseX = getDiagonalX(d);
            const baseY = getDiagonalY(d);
            
            // Handle offset based on side (perpendicular to diagonal)
            let offsetX = 0, offsetY = 0;
            if (d.side === "Left") {
                offsetX = -perpendicularOffset * Math.cos(angle + Math.PI / 2);
                offsetY = -perpendicularOffset * Math.sin(angle + Math.PI / 2);
            } else if (d.side === "Right") {
                offsetX = perpendicularOffset * Math.cos(angle + Math.PI / 2);
                offsetY = perpendicularOffset * Math.sin(angle + Math.PI / 2);
            }
            // If side is N/A (empty string), offsetX and offsetY remain 0
            
            // Stack along the perpendicular direction as well
            const stackDirection = d.side === "Left" ? -1 : (d.side === "Right" ? 1 : 0);
            const stackX = d.stackIndex * stackOffset * stackDirection * Math.cos(angle + Math.PI / 2);
            const stackY = d.stackIndex * stackOffset * stackDirection * Math.sin(angle + Math.PI / 2);
            
            const finalX = baseX + offsetX + stackX + d.jitterX;
            const finalY = baseY + offsetY + stackY + d.jitterY;
            
            return `translate(${finalX}, ${finalY})`;
        })
        .attr("fill", d => locationColors(d.location))
        .attr("opacity", 0.9);





    // Axis
    
    const diagonalAxis = svg.append("g")
        .attr("class", "diagonal-axis");

    // Draw the main diagonal line
    diagonalAxis.append("line")
        .attr("x1", viz_dimensions.margin.left)
        .attr("y1", viz_dimensions.height - viz_dimensions.margin.bottom)
        .attr("x2", viz_dimensions.width - viz_dimensions.margin.right)
        .attr("y2", viz_dimensions.margin.top)
        .attr("stroke", "black")
        .attr("stroke-width", 4);



    // Add ticks along the diagonal
    const ticks = x.ticks(d3.timeHour.every(24)); // Adjust tick frequency as needed
    
    ticks.forEach(tick => {
        const t = (x(tick) - viz_dimensions.margin.left) / 
                  (viz_dimensions.width - viz_dimensions.margin.left - viz_dimensions.margin.right);
        
        const tickX = viz_dimensions.margin.left + t * (viz_dimensions.width - viz_dimensions.margin.left - viz_dimensions.margin.right);
        const tickY = (viz_dimensions.height - viz_dimensions.margin.bottom) - t * (viz_dimensions.height - viz_dimensions.margin.top - viz_dimensions.margin.bottom);
        
        // Tick mark
        diagonalAxis.append("line")
            .attr("x1", tickX)
            .attr("y1", tickY)
            .attr("x2", tickX - 5 * Math.cos((angle + 90) * Math.PI / 180))
            .attr("y2", tickY - 5 * Math.sin((angle + 90) * Math.PI / 180))
            .attr("stroke", "black")
            .attr("stroke-width", 1);
        
        // Tick label
        diagonalAxis.append("text")
            .attr("x", tickX - 15 * Math.cos((angle + 90) * Math.PI / 180))
            .attr("y", tickY - 15 * Math.sin((angle + 90) * Math.PI / 180))
            .attr("text-anchor", "middle")
            .attr("font-size", "10px")
            .text(d3.timeFormat("%b %d, %H:%M")(tick))
            .attr("transform", `rotate(${angle}, ${tickX - 15 * Math.cos((angle + 90) * Math.PI / 180)}, ${tickY - 15 * Math.sin((angle + 90) * Math.PI / 180)})`);
    });

});


